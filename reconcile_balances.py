#!/usr/bin/env python3
"""
Reconcile derived account balances against the real ones.

Account balances are a pure SUM of transactions — nothing is stored, nothing is
hand-maintained. The catch is that the statements do not go back to the day each
account was opened, so the sum is missing the opening position and comes out
wrong by a fixed amount per account.

This script closes that gap the same way you would in a ledger: it writes one
`internal` transaction per account for exactly the missing amount. After it
runs, SUM(transactions) == the real balance, and it stays that way on its own as
new statements come in.

Target balances come from data/accounts.json:

    { "id": "revolut", "balance": 122, "balance_as_of": "2026-07-20" }

`balance_as_of` matters. The target is a point-in-time fact — "there was €122 on
Revolut on the 20th" — not a standing truth. Only transactions dated ON OR BEFORE
that date are diffed against it. Anything later is new activity and is left
alone.

Without the as-of date this script destroys data: state €2,900 for Wise, then add
a real €4,500 payment, re-run, and the diff treats that payment as a €4,500 error
and writes an adjustment cancelling it out. Silently. When you update a target,
update its `balance_as_of` in the same edit.

Idempotent: the adjustment rows are excluded from the derivation before the diff
is taken and rewritten in place, so re-running after a new import produces a new
correct adjustment rather than stacking a second one on top of the first.

Usage:
  python3 reconcile_balances.py --dry-run     # show the adjustments
  python3 reconcile_balances.py               # write them
"""

import argparse
import json
import os
import sqlite3
import sys
from datetime import date, timedelta

BASE = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE, "data", "data.db")
ACCOUNTS_JSON = os.path.join(BASE, "data", "accounts.json")

ADJUST_PREFIX = "opening|"
ADJUST_NAME = "Opening balance"

# The one definition of how a transaction moves money on its own account.
# Mirrored in dashboard/src/lib/aggregate.ts — keep the two in step.
#
# An internal row only ever moves ITS OWN account. It deliberately does not also
# credit `transfer_to`: where both accounts export statements (mBank <-> mCredit)
# each side already has its own row, and crediting the destination as well would
# count every such transfer twice.
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


def targets():
    """Real balances as stated in accounts.json, with the date each was true.

    Accounts with no `balance` key are not tracked and are skipped rather than
    forced to zero. A missing `balance_as_of` defaults to today, which is the
    safe reading of a number someone just typed in.
    """
    today = date.today().isoformat()
    with open(ACCOUNTS_JSON, encoding="utf-8") as f:
        return {
            a["id"]: (float(a["balance"]), a.get("balance_as_of") or today)
            for a in json.load(f)
            if a.get("balance") is not None
        }


def derived(cur, account, as_of):
    """Balance from transactions up to `as_of`.

    Two exclusions, both load-bearing:
      - our own adjustment rows, or the second run would reconcile against its
        own output and converge on nonsense;
      - anything dated after `as_of`, which is activity the stated target never
        claimed to include. Counting it would make real transactions look like
        drift and get them cancelled out by the adjustment.
    """
    row = cur.execute(
        f"SELECT COALESCE({BALANCE_SQL}, 0) FROM transactions "
        "WHERE account = ? AND id NOT LIKE ? AND date <= ?",
        (account, ADJUST_PREFIX + "%", as_of),
    ).fetchone()
    return round(row[0], 2)


def opening_date(cur, account):
    """Date the adjustment in the day before the account's first transaction, so
    every month's income/expense figures stay untouched and the running balance
    is right from the very first row onward."""
    row = cur.execute(
        "SELECT MIN(date) FROM transactions WHERE account = ? AND id NOT LIKE ?",
        (account, ADJUST_PREFIX + "%"),
    ).fetchone()
    if not row or not row[0]:
        return "2026-01-01"
    y, m, d = (int(x) for x in row[0].split("-"))
    return (date(y, m, d) - timedelta(days=1)).isoformat()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(DB_FILE):
        sys.exit(f"No DB at {DB_FILE}. Run: python3 init_db.py")

    conn = sqlite3.connect(DB_FILE)
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()

    known = {r[0] for r in cur.execute("SELECT id FROM accounts")}
    rows, cleared = [], []

    for account, (target, as_of) in sorted(targets().items()):
        if account not in known:
            print(f"  skip {account}: not an account in the DB")
            continue
        have = derived(cur, account, as_of)
        diff = round(target - have, 2)
        adj_id = ADJUST_PREFIX + account

        after = cur.execute(
            "SELECT COUNT(*) FROM transactions "
            "WHERE account = ? AND id NOT LIKE ? AND date > ?",
            (account, ADJUST_PREFIX + "%", as_of),
        ).fetchone()[0]
        later = f"  (+{after} row(s) after {as_of}, untouched)" if after else ""

        if abs(diff) < 0.01:
            # already reconciles on its own — drop any stale adjustment rather
            # than leaving a zero-value row cluttering the ledger
            cleared.append(adj_id)
            print(f"  {account:<9} {have:>10.2f}  ==  {target:>10.2f}   "
                  f"no adjustment needed{later}")
            continue

        rows.append((
            adj_id, opening_date(cur, account), ADJUST_NAME, None,
            abs(diff), "internal", None, account, None,
            "in" if diff > 0 else "out", 0,
            "opening position — statements do not reach account opening",
            "manual", 0,
        ))
        print(f"  {account:<9} {have:>10.2f}  ->  {target:>10.2f}   "
              f"adjust {diff:+.2f}  as of {as_of}{later}")

    if args.dry_run:
        print("\n  --dry-run: nothing written\n")
        return

    for adj_id in cleared:
        cur.execute("DELETE FROM transactions WHERE id = ?", (adj_id,))
    cur.executemany(
        """INSERT OR REPLACE INTO transactions
           (id,date,name,merchant,amount,direction,category,account,
            transfer_to,flow,refund,note,source,planned)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        rows,
    )
    conn.commit()
    print(f"\n  wrote {len(rows)} adjustment(s), removed {len(cleared)} stale\n")


if __name__ == "__main__":
    main()
