#!/usr/bin/env python3
"""
Load data/normalized.csv into data/data.db.

Dedup is by a deterministic row id (date|account|amount|slug of name), so
re-importing an overlapping statement export is a no-op rather than a
duplicate. That only holds because normalize.py is deterministic — same CSV in
means the same id out.

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

BASE = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE, "data", "data.db")
DEFAULT_IN = os.path.join(BASE, "data", "normalized.csv")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40] or "x"


def row_id(r):
    return f"{r['date']}|{r['account']}|{r['amount']}|{slug(r['name'])}"


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
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--replace", action="store_true",
        help="delete existing source='import' rows first. Needed after editing "
             "categorize rules: row ids embed the (re-categorized) name, so a "
             "plain re-import would leave the old rows behind as orphans. "
             "Manually-entered rows are never touched.",
    )
    args = ap.parse_args()

    if not os.path.exists(DB_FILE):
        sys.exit(f"No DB at {DB_FILE}. Run: python3 init_db.py")

    conn = sqlite3.connect(DB_FILE)
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()

    cat_type = dict(cur.execute("SELECT id, type FROM categories"))
    valid_cats = set(cat_type)
    valid_accts = {r[0] for r in cur.execute("SELECT id FROM accounts")}
    if args.replace and not args.dry_run:
        n = cur.execute("DELETE FROM transactions WHERE source='import'").rowcount
        print(f"\n  --replace: removed {n} previously imported rows")

    existing = {r[0] for r in cur.execute("SELECT id FROM transactions")}
    # rows deleted in the dashboard stay deleted. Without this the statement
    # would reinsert them on every --replace and the deletion would look like it
    # silently undid itself.
    try:
        tombstoned = {r[0] for r in cur.execute("SELECT id FROM tx_deleted")}
    except sqlite3.OperationalError:
        tombstoned = set()  # pre-tombstone DB

    with open(args.infile, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

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
            "import", 0,
        ))

    print(f"\n  read {len(rows)}  new {len(new)}  already-present {dupes}  "
          f"rejected {len(bad)}  deleted-in-dashboard {skipped}")
    for rid, why in bad[:10]:
        print(f"    REJECT {why}: {rid}")

    if args.dry_run:
        print("\n  --dry-run: nothing written\n")
        return

    cur.executemany(
        """INSERT INTO transactions
           (id,date,name,merchant,amount,direction,category,account,
            transfer_to,flow,refund,note,source,planned)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        new,
    )
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
