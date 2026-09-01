#!/usr/bin/env python3
"""
Load data/normalized.csv into data/data.db.

Dedup is by a deterministic row id (date|account|amount|slug of name), so
re-importing an overlapping statement export is a no-op rather than a
duplicate. That only holds because normalize.py is deterministic — same CSV in
means the same id out.

Hand-typed planned entries are the one thing that id cannot dedup (their date
and name both drift from what the bank posts), so they get a separate,
looser reconcile pass — see reconcile_settled.

Usage:
  python3 import_csv.py                 # import
  python3 import_csv.py --dry-run       # show what would change
  python3 import_csv.py --in FILE
"""

import argparse
import csv
import json
import os
import re
import sqlite3
import sys
from datetime import date as _date

BASE = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE, "data", "data.db")
DEFAULT_IN = os.path.join(BASE, "data", "normalized.csv")

# Column order for a freshly built row, shared by the INSERT and the reconcile
# step so the two cannot drift into disagreeing about what position 4 means.
NEW_COLS = ("id", "date", "name", "merchant", "amount", "direction", "category",
            "account", "transfer_to", "flow", "refund", "note", "source",
            "planned", "source_file")
CATEGORY_IDX = NEW_COLS.index("category")
DIRECTION_IDX = NEW_COLS.index("direction")

# How far apart a planned entry and the statement row that fulfils it may be
# dated, and how close their amounts have to be. Same idea and same tolerance as
# ledger.pair_internal uses to marry the two legs of a transfer.
SETTLE_WINDOW_DAYS = 5
CENT = 0.005


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40] or "x"


def row_id(r):
    return f"{r['date']}|{r['account']}|{r['amount']}|{slug(r['name'])}"


def reconcile_settled(cur, new_rows):
    """Match statement rows to the planned entries they fulfil. Returns pairs.

    A planned entry becomes real when its date arrives (serve.py's sweep) or
    when you say so by hand. Later the statement covering that date is imported
    and the bank's own row for the same payment lands too — and it does NOT
    dedup against the manual one, because the row id is built from date + name
    and both drift: you type "Rent" dated the 25th, the bank posts
    "Rent (deposit + 2x rent)" on the 27th. Two ids, two rows, one payment
    counted twice.

    So match on the parts that do not drift — account, direction, amount, and a
    date within a few days — and let the statement win, since it is the record
    of what the bank actually did.

    Only rows carrying `settled_at` are candidates. An ordinary hand-typed entry
    never was a plan and must never be swallowed by a look-alike import row.
    Each candidate matches at most once, so two identical planned entries in the
    same window consume two statement rows rather than collapsing into one.
    """
    try:
        cands = [
            dict(zip(("id", "date", "amount", "direction", "account"), r))
            for r in cur.execute(
                """SELECT id, date, amount, direction, account FROM transactions
                   WHERE source='manual' AND settled_at IS NOT NULL""")
        ]
    except sqlite3.OperationalError:
        return []  # DB predates settled_at — nothing was ever auto-settled

    taken, matched = set(), []
    for row in new_rows:
        r = dict(zip(NEW_COLS, row))
        for c in cands:
            if c["id"] in taken:
                continue
            if c["account"] != r["account"] or c["direction"] != r["direction"]:
                continue
            if abs(c["amount"] - float(r["amount"])) > CENT:
                continue
            gap = _date.fromisoformat(r["date"][:10]) - _date.fromisoformat(c["date"][:10])
            if abs(gap.days) > SETTLE_WINDOW_DAYS:
                continue
            taken.add(c["id"])
            matched.append((c["id"], r["id"]))
            break
    return matched


def prune_overrides(cur):
    """Drop dashboard edits that the rules now produce on their own, and report
    ones whose transaction no longer exists.

    Both cases come from the same event: a rules edit. If you fix a merchant's
    category in categorize.json after having already fixed it in the dashboard,
    the override becomes a no-op and should disappear rather than shadow the
    rule forever. If the rules change the *name*, the row id changes with it
    (ids embed the name slug) and the override is stranded — that can't be
    auto-resolved, so it's surfaced instead of silently dropped.
    """
    try:
        rows = list(cur.execute("SELECT id, fields FROM tx_overrides"))
    except sqlite3.OperationalError:
        return  # table not created yet — pre-overrides DB

    redundant, orphaned = [], []
    for oid, blob in rows:
        base = cur.execute("SELECT * FROM transactions WHERE id=?", (oid,)).fetchone()
        if base is None:
            orphaned.append(oid)
            continue
        cols = [c[0] for c in cur.description]
        base = dict(zip(cols, base))
        if all(base.get(k) == v for k, v in json.loads(blob).items()):
            redundant.append(oid)

    for oid in redundant:
        cur.execute("DELETE FROM tx_overrides WHERE id=?", (oid,))
    if redundant:
        print(f"  overrides: dropped {len(redundant)} now matched by the rules")
    if orphaned:
        print(f"  overrides: {len(orphaned)} ORPHANED (transaction id no longer exists):")
        for oid in orphaned[:10]:
            print(f"    {oid}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", default=DEFAULT_IN)
    ap.add_argument("--db", dest="dbfile", default=DB_FILE,
                    help=argparse.SUPPRESS)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--allow-uncategorized", action="store_true",
        help="commit even when most incoming rows carry no category "
             "(normally a sign the categorize rules never matched)",
    )
    ap.add_argument(
        "--replace", action="store_true",
        help="deprecated unsafe mode; requires --replace-source-file",
    )
    ap.add_argument(
        "--replace-source-file", metavar="FILE",
        help="replace only imported rows from this normalized source filename",
    )
    args = ap.parse_args()

    if args.replace and not args.replace_source_file:
        ap.error("--replace is unsafe without an explicit --replace-source-file FILE")
    if args.replace_source_file and not args.replace:
        args.replace = True
    if not os.path.exists(args.dbfile):
        sys.exit(f"No DB at {args.dbfile}. Run: python3 init_db.py")

    conn = sqlite3.connect(args.dbfile)
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()

    with open(args.infile, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    cat_type = dict(cur.execute("SELECT id, type FROM categories"))
    valid_cats = set(cat_type)
    valid_accts = {r[0] for r in cur.execute("SELECT id FROM accounts")}
    legacy_ids = tuple(row_id(r) for r in rows)
    replace_clauses = ["source_file=?"]
    replace_params = [args.replace_source_file]
    if legacy_ids:
        placeholders = ",".join("?" for _ in legacy_ids)
        replace_clauses.append(
            f"(source_file IS NULL AND id IN ({placeholders}))"
        )
        replace_params.extend(legacy_ids)

    if args.replace_source_file:
        existing = {
            r[0] for r in cur.execute(
                "SELECT id FROM transactions WHERE NOT (source='import' AND (" +
                " OR ".join(replace_clauses) + "))", replace_params,
            )
        }
    else:
        existing = {r[0] for r in cur.execute("SELECT id FROM transactions")}
    # rows deleted in the dashboard stay deleted. Without this the statement
    # would reinsert them on every --replace and the deletion would look like it
    # silently undid itself.
    try:
        tombstoned = {r[0] for r in cur.execute("SELECT id FROM tx_deleted")}
    except sqlite3.OperationalError:
        tombstoned = set()  # pre-tombstone DB

    new, dupes, bad, skipped = [], 0, [], 0
    seen = set()
    for r in rows:
        rid = row_id(r)
        # a same-day, same-amount, same-merchant pair is nearly always a real
        # duplicate export row, but suffix rather than drop so we never lose data
        if rid in seen:
            n = 2
            while f"{rid}#{n}" in seen:
                n += 1
            rid = f"{rid}#{n}"
        seen.add(rid)

        if r["account"] not in valid_accts:
            bad.append((rid, f"unknown account {r['account']}"))
            continue
        if r["category"] and r["category"] not in valid_cats:
            bad.append((rid, f"unknown category {r['category']}"))
            continue
        # an income row tagged with an expense-typed category (or vice versa)
        # is a categorize-rule bug, not a data quirk — reject loudly
        if (r["category"] and r["direction"] in ("income", "expense")
                and cat_type[r["category"]] != r["direction"]):
            bad.append((rid, f"{r['direction']} row in "
                             f"{cat_type[r['category']]}-typed category "
                             f"'{r['category']}'"))
            continue
        if rid in tombstoned:
            skipped += 1
            continue
        if rid in existing:
            dupes += 1
            continue
        new.append((
            rid, r["date"], r["name"], r["merchant"] or None,
            float(r["amount"]), r["direction"], r["category"] or None,
            r["account"], r["transfer_to"] or None,
            # flow only means something for internal rows; for income/expense
            # `direction` is the sign and a stray flow would be noise
            (r.get("flow") or None) if r["direction"] == "internal" else None,
            1 if r.get("refund") else 0,
            r["note"] or None,
            "import", 0, r.get("source_file") or None,
        ))

    print(f"\n  read {len(rows)}  new {len(new)}  already-present {dupes}  "
          f"rejected {len(bad)}  deleted-in-dashboard {skipped}")
    for rid, why in bad[:10]:
        print(f"    REJECT {why}: {rid}")

    # CATEGORY_IDX / DIRECTION_IDX track the tuple layout of `new` above.
    uncategorized = [t for t in new
                     if not t[CATEGORY_IDX] and t[DIRECTION_IDX] != "internal"]
    categorizable = [t for t in new if t[DIRECTION_IDX] != "internal"]
    if uncategorized:
        share = len(uncategorized) / max(len(categorizable), 1)
        print(f"\n  uncategorized: {len(uncategorized)} of {len(categorizable)} "
              f"incoming non-transfer rows ({share:.0%})")
        for t in uncategorized[:10]:
            print(f"    no category: {t[2]}")
        if share >= 0.3:
            print("\n  This is what a failed categorization looks like. Add merchant\n"
                  "  rules to rules/categorize.json, re-run normalize.py, and dry-run\n"
                  "  again before committing.")
            if not args.dry_run and not args.allow_uncategorized:
                sys.exit("\n  refusing to commit: fix the rules, or pass "
                         "--allow-uncategorized if this really is correct\n")

    # Planned entries this statement turns out to be the real record of. Printed
    # in full (never truncated) — each line is a row about to be dropped.
    settled = reconcile_settled(cur, new)
    if settled:
        print(f"\n  planned entries fulfilled by this statement: {len(settled)}")
        for manual_id, import_id in settled:
            print(f"    drop  {manual_id}")
            print(f"      for {import_id}")

    if bad and args.replace_source_file and not args.dry_run:
        conn.rollback()
        sys.exit("scoped replacement aborted: rejected rows would leave the existing source untouched")

    if args.dry_run:
        print("\n  --dry-run: nothing written\n")
        return

    if args.replace_source_file:
        n = cur.execute(
            "DELETE FROM transactions WHERE source='import' AND (" +
            " OR ".join(replace_clauses) + ")", replace_params,
        ).rowcount
        print(f"\n  --replace-source-file {args.replace_source_file}: removed {n} rows")

    cur.executemany(
        f"""INSERT INTO transactions ({",".join(NEW_COLS)})
            VALUES ({",".join("?" for _ in NEW_COLS)})""",
        new,
    )

    # The planned entry and its statement row are the same payment, so only one
    # may survive. Hard-deleted rather than tombstoned: it was hand-typed, and
    # nothing regenerates it. Its override goes with it, same as delete_transaction.
    if settled:
        drop = [(mid,) for mid, _ in settled]
        cur.executemany("DELETE FROM tx_overrides WHERE id=?", drop)
        cur.executemany("DELETE FROM transactions WHERE id=?", drop)

    conn.commit()

    prune_overrides(cur)
    conn.commit()

    tot = cur.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    print(f"  committed. transactions in db: {tot}\n")
    for d, n, s in cur.execute(
        """SELECT direction, COUNT(*), ROUND(SUM(amount),2)
           FROM transactions GROUP BY direction"""
    ):
        print(f"    {d:<9} {n:>4}  {s:>10.2f}")
    print()


if __name__ == "__main__":
    main()
