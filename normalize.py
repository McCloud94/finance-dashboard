#!/usr/bin/env python3
"""
Step 0 of the finance pipeline: turn arbitrary bank CSV exports into one
unified normalized.csv that the importer can consume.

The engine here is dumb on purpose — all bank-specific knowledge lives as data
in profiles/*.json. Adding a new bank means writing a profile, never editing
this file. That keeps the pipeline deterministic (same CSV in -> byte-identical
CSV out), which is what makes import dedup by row id actually hold.

Usage:
  python3 normalize.py                      # Statements/ -> data/normalized.csv
  python3 normalize.py --in DIR --out FILE
  python3 normalize.py --report             # show unmatched files + rule stats
"""

import argparse
import csv
import glob
import json
import os
import re
import sys
import unicodedata
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
PROFILE_DIR = os.path.join(BASE, "profiles")
DEFAULT_IN = os.path.join(BASE, "Statements")
DEFAULT_OUT = os.path.join(BASE, "data", "normalized.csv")

FIELDS = [
    "date", "name", "merchant", "amount", "direction", "flow", "refund",
    "account", "transfer_to", "category", "note", "source_file",
]

CAT_TYPES = {}          # category id -> 'income'|'expense'; filled in main()

# every whitespace char a bank might use as a thousands separator
SPACES = "    "


# ── profile loading ────────────────────────────────────────────────────────

def load_profiles():
    profiles = []
    for path in sorted(glob.glob(os.path.join(PROFILE_DIR, "*.json"))):
        with open(path, encoding="utf-8") as f:
            p = json.load(f)
        p["_path"] = path
        profiles.append(p)
    return profiles


def match_profile(header, profiles):
    """Pick the profile whose required headers are all present.

    Sorted by specificity: mBank's account and credit exports share 4 of 5
    columns, so the profile demanding the most columns must win.
    """
    cols = set(header)
    hits = [p for p in profiles if set(p["match"]["headers_all"]) <= cols]
    if not hits:
        return None
    return max(hits, key=lambda p: len(p["match"]["headers_all"]))


# ── field extraction ───────────────────────────────────────────────────────

def pick(row, spec):
    """Resolve a text field spec -> string."""
    val = ""
    for col in spec.get("coalesce", [spec.get("col")]):
        if col and row.get(col, "").strip():
            val = row[col].strip()
            break
    ex = spec.get("extract")
    if ex:
        m = re.search(ex["pattern"], val)
        if m:
            val = m.group(ex.get("group", 1)).strip()
    return re.sub(r"\s+", " ", val).strip()


def parse_amount(raw, spec):
    s = raw.strip()
    for ch in SPACES + (spec.get("thousands") or ""):
        s = s.replace(ch, "")
    s = re.sub(r"[A-Za-z€$£]+", "", s).strip()      # "-43.50 EUR" -> "-43.50"
    if spec.get("decimal", ".") == ",":
        s = s.replace(",", ".")
    else:
        s = s.replace(",", "")
    return float(s)


def parse_date(row, spec):
    """Resolve via the same coalesce rules as text fields, then strip any time
    component (Revolut/Bybit ship 'YYYY-MM-DD HH:MM:SS' in one column)."""
    raw = ""
    for col in spec.get("coalesce", [spec.get("col")]):
        if col and row.get(col, "").strip():
            raw = row[col].strip()
            break
    if not raw:
        raise ValueError("no date")
    return datetime.strptime(raw.split(" ")[0], spec["format"]).strftime("%Y-%m-%d")


def norm(s):
    """Strip diacritics + lowercase, so rules match 'SPLÁTKA' and 'SPLATKA'."""
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def apply_rules(rules, haystack, tx, stats):
    """First matching rule wins. Rules can force direction/category/name."""
    for r in rules:
        if re.search(norm(r["match"]), haystack):
            for k in ("direction", "category", "transfer_to", "name", "note"):
                if k in r:
                    tx[k] = r[k]
            stats[r["match"]] = stats.get(r["match"], 0) + 1
            return r
    return None


# ── global categorize pass ─────────────────────────────────────────────────

def load_categorize():
    path = os.path.join(BASE, "rules", "categorize.json")
    try:
        with open(path, encoding="utf-8") as f:
            r = json.load(f)
    except FileNotFoundError:
        return [], []
    merchants = [(re.compile(norm(p)), name) for p, name in r.get("merchants", {}).items()]
    cats = [(cat, re.compile("|".join(norm(p) for p in pats)))
            for cat, pats in r.get("categories", {}).items()]
    return merchants, cats


def load_cat_types():
    try:
        with open(os.path.join(BASE, "data", "categories.json"), encoding="utf-8") as f:
            return {c["id"]: c["type"] for c in json.load(f)}
    except FileNotFoundError:
        return {}


def categorize(tx, merchants, cats):
    """Bank-agnostic pass: canonicalize merchant name, then assign category.

    Runs AFTER profile rules so a bank-specific rule (e.g. mCredit 'SPLATKA' ->
    internal) always wins over a generic merchant match.
    """
    if tx["direction"] == "internal":
        return
    hay = norm(f"{tx['name']} {tx['merchant']}")
    for pat, clean in merchants:
        if pat.search(hay):
            tx["name"] = clean
            # fold the canonical name back in, so category rules can key off
            # 'multisport' even though the statement said 'PEHELOV'
            hay = norm(clean) + " " + hay
            break
    if not tx["category"]:
        for cat, pat in cats:
            if pat.search(hay):
                tx["category"] = cat
                break

    # Money coming IN that matched an expense category is a refund (Canva
    # refund, festival ticket resale). A refund is not income — it is negative
    # spend in the category it came from.
    #
    # It is stored as an EXPENSE with refund=1, not as income with a stripped
    # category. Keeping direction='expense' means the importer's category-type
    # check still applies (a Canva refund belongs in `business`, an expense
    # category), `amount` stays positive, and every aggregate can subtract it
    # from that category. The earlier approach — drop the category, leave it as
    # income — both overstated income and left the original category overstated
    # by the refunded amount.
    #
    # Pairing the refund against the original transaction and deleting both is
    # not viable: partial refunds (€3 back on a €278 festival ticket) have no
    # row to cancel.
    ctype = CAT_TYPES.get(tx["category"])
    if tx["direction"] == "income" and ctype == "expense":
        tx["note"] = (tx["note"] + "; " if tx["note"] else "") + "refund"
        tx["name"] = f"Refund: {tx['name']}"
        tx["direction"] = "expense"
        tx["refund"] = "1"


# ── main normalization ─────────────────────────────────────────────────────

def normalize_file(path, profile, stats, merchants, cats):
    out = []
    enc = profile.get("encoding", "utf-8")
    cols = profile["columns"]
    rules = profile.get("rules", [])
    skip = profile.get("skip", [])

    rfilter = profile.get("row_filter")

    with open(path, newline="", encoding=enc) as f:
        for row in csv.DictReader(f):
            # column-value gate (e.g. Revolut State != REVERTED/FAILED)
            if rfilter and row.get(rfilter["col"], "").strip() in rfilter["exclude"]:
                continue
            try:
                amount = parse_amount(row[cols["amount"]["col"]], cols["amount"])
                date = parse_date(row, cols["date"])
            except (ValueError, KeyError, TypeError):
                continue                       # header repeat / blank / total row
            if amount == 0:
                continue

            name = pick(row, cols["name"])
            merchant = pick(row, cols["merchant"]) if "merchant" in cols else ""
            if not name:
                name = merchant or "(no description)"

            hay = norm(f"{name} {merchant}")
            if any(re.search(norm(p), hay) for p in skip):
                continue

            tx = {
                "date": date,
                "name": name,
                "merchant": merchant,
                "amount": round(abs(amount), 2),
                "direction": "income" if amount > 0 else "expense",
                # Captured BEFORE apply_rules, which overwrites `direction` with
                # 'internal' for own-account transfers and so destroys the only
                # record of which way the money moved. Account balances are
                # derived from these rows, and an unsigned transfer makes that
                # impossible — 79 internal rows worth €35k had no direction.
                "flow": "in" if amount > 0 else "out",
                "account": profile["account"],
                "transfer_to": "",
                "category": "",
                "refund": "",
                "note": "",
                "source_file": os.path.basename(path),
            }
            apply_rules(rules, hay, tx, stats)
            categorize(tx, merchants, cats)
            out.append(tx)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="indir", default=DEFAULT_IN)
    ap.add_argument("--out", dest="outfile", default=DEFAULT_OUT)
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    profiles = load_profiles()
    if not profiles:
        sys.exit(f"No profiles in {PROFILE_DIR}")

    merchants, cats = load_categorize()
    CAT_TYPES.update(load_cat_types())
    files = sorted(glob.glob(os.path.join(args.indir, "*.csv")))
    all_tx, matched, unmatched = [], [], []
    stats = {}

    for path in files:
        with open(path, newline="", encoding="utf-8", errors="replace") as f:
            header = next(csv.reader(f), [])
        prof = match_profile(header, profiles)
        if not prof:
            unmatched.append((path, header))
            continue
        txs = normalize_file(path, prof, stats, merchants, cats)
        all_tx.extend(txs)
        matched.append((os.path.basename(path), prof["name"], len(txs)))

    all_tx.sort(key=lambda t: (t["date"], t["name"]))

    os.makedirs(os.path.dirname(args.outfile), exist_ok=True)
    with open(args.outfile, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(all_tx)

    print(f"\n  {len(all_tx)} transactions -> {args.outfile}\n")
    for fname, pname, n in matched:
        print(f"  ok   {fname:<22} {pname:<16} {n:>4} rows")
    for path, header in unmatched:
        print(f"  MISS {os.path.basename(path):<22} no profile matches "
              f"headers: {header}")

    if args.report:
        by_dir, by_acct, uncat = {}, {}, 0
        for t in all_tx:
            by_dir[t["direction"]] = by_dir.get(t["direction"], 0) + 1
            by_acct[t["account"]] = by_acct.get(t["account"], 0) + 1
            if not t["category"] and t["direction"] != "internal":
                uncat += 1
        print("\n  direction:", by_dir)
        print("  account:  ", by_acct)
        print(f"  uncategorized (needs review): {uncat}")
        print("\n  rule hits:")
        for k, v in sorted(stats.items(), key=lambda kv: -kv[1]):
            print(f"    {v:>4}  {k}")


if __name__ == "__main__":
    main()
