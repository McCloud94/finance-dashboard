#!/usr/bin/env python3
"""
The one definition of how a transaction moves money.

Imported by serve.py (which ships the result to the dashboard) and by
reconcile_balances.py (which diffs it against the real balances). The frontend
mirror lives in dashboard/src/lib/aggregate.ts — keep the three in step.

--------------------------------------------------------------------------
Why internal transfers need pairing
--------------------------------------------------------------------------
An internal transfer is one movement of money seen from two sides. Whether the
ledger holds one row for it or two depends entirely on which statements were
imported:

  * Current account -> that bank's own credit card: BOTH sides export a
    statement, so the import produces two rows — an `out` on the account and an
    `in` on the card. Each row moves its own account and the transfer balances
    itself. Crediting the destination as well would count the transfer twice.

  * Revolut -> Bybit: only Revolut exports the movement. Bybit's export has the
    spending but not the deposits, so there is exactly ONE row. If that row only
    debits Revolut, the money vanishes: Bybit spends forever against a balance
    nothing ever tops up, and drifts steadily negative.

  * A transfer typed into the dashboard by hand is also one row. "Pay back
    credit card", account -> card, left the card's outstanding untouched for the
    same reason.

So neither "always single-entry" nor "always double-entry" is right. The rule
that is right: a transfer is double-entry unless the opposite leg is already in
the ledger. pair_internal() finds those opposite legs; everything left over
moves both accounts.
"""

from datetime import date as _date

__all__ = ["pair_internal", "balance_delta", "account_balances", "BALANCE_SQL"]

# Kept for callers that still want the single-account SQL form. It does NOT
# include the counterparty leg of an unpaired transfer — anything that needs a
# correct balance should use account_balances() instead.
BALANCE_SQL = """
SUM(CASE
  WHEN planned = 1                                THEN 0
  WHEN direction = 'income'                       THEN amount
  WHEN direction = 'expense' AND refund = 1       THEN amount
  WHEN direction = 'expense'                      THEN -amount
  WHEN direction = 'internal' AND flow = 'in'     THEN amount
  WHEN direction = 'internal' AND flow = 'out'    THEN -amount
  ELSE 0
END)
"""

# How far apart the two legs of one transfer may be dated. Banks post the same
# movement on different days; three days covers a weekend without being loose
# enough to marry two genuinely different transfers of the same amount.
PAIR_WINDOW_DAYS = 3
CENT = 0.005


def _d(s):
    y, m, d = (int(x) for x in str(s)[:10].split("-"))
    return _date(y, m, d)


def _get(t, k, default=None):
    """Rows arrive as dicts or sqlite3.Row — read both the same way."""
    try:
        v = t[k]
    except (KeyError, IndexError):
        return default
    return default if v is None else v


def pair_internal(txs):
    """{transaction_id: counterpart_id} for internal rows that have both legs.

    A row that is absent from this map (or maps to None) is a transfer the
    ledger only saw from one side, and therefore has to move both accounts.

    Matching is greedy on (same amount, mirrored accounts, nearest date within
    PAIR_WINDOW_DAYS) and iterates in date order, so it is deterministic and a
    leg is never claimed twice.
    """
    internal = [t for t in txs if _get(t, "direction") == "internal"]
    ins = [t for t in internal if _get(t, "flow") == "in"]
    outs = [t for t in internal if _get(t, "flow") == "out"]

    # index the candidate legs by the account they sit on
    by_account = {}
    for t in ins + outs:
        by_account.setdefault(_get(t, "account"), []).append(t)

    claimed = set()
    pairs = {}

    def match(src, want_flow):
        """Nearest unclaimed mirror leg of `src` on its transfer_to account."""
        other = _get(src, "transfer_to")
        if not other:
            return None
        amount = float(_get(src, "amount", 0))
        d0 = _d(_get(src, "date"))
        best, best_gap = None, None
        for cand in by_account.get(other, ()):
            cid = _get(cand, "id")
            if cid in claimed or cid == _get(src, "id"):
                continue
            if _get(cand, "flow") != want_flow:
                continue
            if abs(float(_get(cand, "amount", 0)) - amount) > CENT:
                continue
            gap = abs((_d(_get(cand, "date")) - d0).days)
            if gap > PAIR_WINDOW_DAYS:
                continue
            if best_gap is None or gap < best_gap:
                best, best_gap = cand, gap
        return best

    # drive from the `out` legs: money leaving an account is the side that
    # always exists (you cannot spend from an account you never see)
    for src in sorted(outs, key=lambda t: (str(_get(t, "date")), str(_get(t, "id")))):
        if _get(src, "id") in claimed:
            continue
        dst = match(src, "in")
        if dst is None:
            continue
        claimed.add(_get(src, "id"))
        claimed.add(_get(dst, "id"))
        pairs[_get(src, "id")] = _get(dst, "id")
        pairs[_get(dst, "id")] = _get(src, "id")

    return pairs


def balance_delta(t):
    """What one row does to the balance of its OWN account."""
    if _get(t, "planned", 0):
        return 0.0  # not real money yet
    amount = float(_get(t, "amount", 0))
    direction = _get(t, "direction")
    if direction == "income":
        return amount
    if direction == "expense":
        return amount if _get(t, "refund", 0) else -amount  # a refund puts money back
    if direction == "internal":
        flow = _get(t, "flow")
        return amount if flow == "in" else -amount if flow == "out" else 0.0
    return 0.0


def account_balances(txs, account_ids=None, as_of=None, exclude_ids=()):
    """{account_id: balance}, transactions summed with transfer pairing applied.

    `as_of`       — ignore rows dated after this (reconcile diffs a point-in-time
                    target and must not treat later activity as drift).
    `exclude_ids` — rows to leave out entirely, so reconcile can drop its own
                    adjustment rows before measuring the gap they exist to fill.

    Pairing is computed on the FILTERED set: a transfer whose opposite leg falls
    outside the window has, for this calculation, only one leg.
    """
    exclude_ids = set(exclude_ids)
    rows = [
        t for t in txs
        if _get(t, "id") not in exclude_ids
        and (as_of is None or str(_get(t, "date"))[:10] <= as_of)
    ]
    pairs = pair_internal(rows)

    sums = {a: 0.0 for a in (account_ids or ())}
    for t in rows:
        acct = _get(t, "account")
        if account_ids is not None and acct not in sums:
            continue
        sums[acct] = sums.get(acct, 0.0) + balance_delta(t)

        # the missing opposite leg: an unpaired transfer moves the counterparty
        # by the mirror of what it did here
        if _get(t, "direction") != "internal" or pairs.get(_get(t, "id")):
            continue
        other = _get(t, "transfer_to")
        if not other or (account_ids is not None and other not in sums):
            continue
        sums[other] = sums.get(other, 0.0) - balance_delta(t)

    return {k: round(v, 2) for k, v in sums.items()}
