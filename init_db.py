#!/usr/bin/env python3
"""
Create the Personal-OS SQLite schema at data/data.db and seed reference config
(categories, accounts, budget) from the existing JSON files.

Transactions are NOT imported — the DB starts at zero tx by design. Bank
statements get imported later via the import pipeline.

Idempotent: safe to re-run. Schema uses CREATE TABLE IF NOT EXISTS; reference
seeds use INSERT OR IGNORE (won't clobber edited rows / balances).

Usage:
  python3 init_db.py                 # create schema + seed reference config
  python3 init_db.py --reset         # DROP everything first, then recreate (DESTRUCTIVE)
"""

import json
import os
import sqlite3
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "data")
DB_FILE = os.path.join(DATA_DIR, "data.db")

SCHEMA = """
-- ── Finances ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
    id     TEXT PRIMARY KEY,
    name   TEXT NOT NULL,
    color  TEXT,
    type   TEXT NOT NULL CHECK (type IN ('income','expense'))
);

CREATE TABLE IF NOT EXISTS accounts (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    -- 'credit' = a credit card. Its balance is negative (what you owe) and it
    -- is excluded from cash, so a maxed card can never read as money you have.
    type      TEXT DEFAULT 'bank' CHECK (type IN ('bank','prop_firm','crypto','broker','cash','credit')),
    balance   REAL DEFAULT 0,
    currency  TEXT DEFAULT 'EUR',
    meta      TEXT DEFAULT '{}'          -- arbitrary JSON blob
);

CREATE TABLE IF NOT EXISTS transactions (
    id         TEXT PRIMARY KEY,          -- date-slug-account-amount, dedup key
    date       TEXT NOT NULL,             -- YYYY-MM-DD
    name       TEXT NOT NULL,
    merchant   TEXT,
    amount     REAL NOT NULL CHECK (amount > 0),
    direction  TEXT NOT NULL CHECK (direction IN ('income','expense','internal')),
    category   TEXT REFERENCES categories(id),
    account    TEXT REFERENCES accounts(id),
    transfer_to TEXT REFERENCES accounts(id),  -- set when direction='internal' and dest known
    -- Which way an internal transfer moved money on `account`. NULL for
    -- income/expense, where `direction` already carries the sign. Without this
    -- an internal row is unsigned and account balances cannot be derived at all
    -- (apply_rules used to overwrite the statement's sign with 'internal').
    flow       TEXT CHECK (flow IS NULL OR flow IN ('in','out')),
    -- Money coming back on an expense: a refund is not income, it is negative
    -- spend in the category it came from. Stored as direction='expense' with
    -- refund=1 so the category type check still holds and `amount` stays > 0;
    -- every aggregate subtracts it instead of adding.
    refund     INTEGER DEFAULT 0,         -- 0/1
    note       TEXT,
    source     TEXT DEFAULT 'manual',     -- manual | import
    source_file TEXT,                      -- normalized statement filename for scoped replacement
    planned    INTEGER DEFAULT 0,           -- 0/1
    -- May the date sweep in serve.py settle this planned row when its date
    -- arrives? Cleared when you flip a row back to Planned by hand — that is
    -- you overruling the sweep, so the sweep must not overrule you back on the
    -- next page load. Re-armed automatically once the row's date is future again.
    auto_settle INTEGER DEFAULT 1,          -- 0/1
    -- When this manual row stopped being a plan and started counting as real
    -- money (by the sweep or by hand). NULL for every row that was never a plan.
    -- It is the marker import_csv.py's reconcile step matches on: the statement
    -- row for the same payment will not dedup by id (see reconcile_settled), so
    -- only rows that were once planned may be replaced by an imported one.
    settled_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_cat_date  ON transactions(category, date);
CREATE INDEX IF NOT EXISTS idx_tx_date      ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_account   ON transactions(account);

CREATE TABLE IF NOT EXISTS budget_limits (
    category      TEXT PRIMARY KEY REFERENCES categories(id),
    monthly_limit REAL NOT NULL
);

-- what you owe (and what's owed to you). Credit cards live here alongside
-- family loans so 'total debt' is one query, not a special case per kind.
CREATE TABLE IF NOT EXISTS debts (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('credit_card','loan','owed_to_me')),
    counterparty TEXT,
    account      TEXT REFERENCES accounts(id),   -- credit cards map to an account
    credit_limit REAL,                           -- credit_card only
    balance      REAL NOT NULL DEFAULT 0,        -- total outstanding
    due_amount   REAL,                           -- from last statement
    due_date     TEXT,                           -- YYYY-MM-DD
    note         TEXT,
    updated_at   TEXT DEFAULT (datetime('now'))
);

-- Dashboard edits. The dashboard is the source of truth: whatever you change
-- there wins over whatever the importer derived. Deliberately NOT foreign-keyed
-- to transactions — import_csv.py --replace deletes and recreates the imported
-- rows, and an override must survive that. `fields` is a JSON object of just
-- the changed columns, overlaid at read time in Store.snapshot().
CREATE TABLE IF NOT EXISTS tx_overrides (
    id         TEXT PRIMARY KEY,          -- transactions.id
    fields     TEXT NOT NULL,             -- {"category":"job","name":"..."}
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Rows you deleted in the dashboard. Same reasoning as tx_overrides, and the
-- same deliberate lack of a foreign key: import_csv.py --replace rebuilds the
-- imported rows from the statements, so a plain DELETE would be undone by the
-- next import. A tombstone here outlives that and is filtered out at read time.
-- Manually-added rows are hard-deleted instead — nothing would recreate them.
CREATE TABLE IF NOT EXISTS tx_deleted (
    id         TEXT PRIMARY KEY,          -- transactions.id
    deleted_at TEXT DEFAULT (datetime('now'))
);

-- generic key/value config (planned_income, etc.)
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- ── Personal-OS (projects / milestones / streaks / metrics) ───────────────
CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    status      TEXT DEFAULT 'active',
    start_date  TEXT,
    target_date TEXT
);

CREATE TABLE IF NOT EXISTS milestones (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    done       INTEGER DEFAULT 0,
    done_at    TEXT,
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS streaks (
    key         TEXT PRIMARY KEY,          -- 'finance_update' | 'trade_log' ...
    last_done   TEXT,
    current_len INTEGER DEFAULT 0,
    best_len    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS metrics (
    key        TEXT PRIMARY KEY,
    value      REAL,
    updated_at TEXT DEFAULT (datetime('now'))
);
"""

DROP = """
DROP TABLE IF EXISTS tx_deleted;
DROP TABLE IF EXISTS tx_overrides;
DROP TABLE IF EXISTS metrics;
DROP TABLE IF EXISTS streaks;
DROP TABLE IF EXISTS milestones;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS debts;
DROP TABLE IF EXISTS budget_limits;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS categories;
"""


def read_json(name, default):
    path = os.path.join(DATA_DIR, name)
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


# Columns added after the first release. CREATE TABLE IF NOT EXISTS silently
# does nothing on an existing DB, so new columns have to be ALTERed in or a
# re-run leaves the schema a version behind while reporting success.
MIGRATIONS = [
    ("transactions", "flow", "TEXT"),
    ("transactions", "refund", "INTEGER DEFAULT 0"),
    ("transactions", "source_file", "TEXT"),
    ("transactions", "auto_settle", "INTEGER DEFAULT 1"),
    ("transactions", "settled_at", "TEXT"),
]


def migrate_account_types(conn):
    """Widen accounts.type to allow 'credit'.

    SQLite cannot ALTER a CHECK constraint, and CREATE TABLE IF NOT EXISTS leaves
    an existing table's constraint untouched — so a DB created before 'credit'
    existed would keep rejecting it while the schema in this file claims
    otherwise. Rebuild-and-copy is the only way to change it in place.
    """
    cur = conn.cursor()
    sql = cur.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts'"
    ).fetchone()
    if not sql or "'credit'" in sql[0]:
        return  # fresh DB, or already migrated

    cur.executescript("""
        PRAGMA foreign_keys = OFF;
        CREATE TABLE accounts_new (
            id        TEXT PRIMARY KEY,
            name      TEXT NOT NULL,
            type      TEXT DEFAULT 'bank' CHECK (type IN ('bank','prop_firm','crypto','broker','cash','credit')),
            balance   REAL DEFAULT 0,
            currency  TEXT DEFAULT 'EUR',
            meta      TEXT DEFAULT '{}'
        );
        INSERT INTO accounts_new SELECT id,name,type,balance,currency,meta FROM accounts;
        DROP TABLE accounts;
        ALTER TABLE accounts_new RENAME TO accounts;
        PRAGMA foreign_keys = ON;
    """)
    conn.commit()
    print("  migrated: accounts.type now allows 'credit'")


def migrate(conn):
    migrate_account_types(conn)
    cur = conn.cursor()
    for table, col, decl in MIGRATIONS:
        cols = {r[1] for r in cur.execute(f"PRAGMA table_info({table})")}
        if col not in cols:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
            print(f"  migrated: {table}.{col} added")
    conn.commit()


def seed(conn):
    cur = conn.cursor()

    # categories
    for c in read_json("categories.json", []):
        cur.execute(
            "INSERT OR IGNORE INTO categories (id,name,color,type) VALUES (?,?,?,?)",
            (c["id"], c["name"], c.get("color"), c["type"]),
        )

    # accounts.
    for a in read_json("accounts.json", []):
        cur.execute(
            "INSERT OR IGNORE INTO accounts (id,name,type,currency,balance) VALUES (?,?,?,?,?)",
            (a["id"], a["name"], a.get("type", "bank"), a.get("currency", "EUR"),
             a.get("balance") or 0),
        )
        # name/currency/type are config and the seed file owns them, so a re-run
        # picks up a rename or a retype. `balance` is the reconcile TARGET — the
        # real-world number you state for this account — and reconcile_balances.py
        # reads it from this file directly, so it is refreshed here too.
        cur.execute(
            "UPDATE accounts SET name=?, type=?, currency=?, balance=? WHERE id=?",
            (a["name"], a.get("type", "bank"), a.get("currency", "EUR"),
             a.get("balance") or 0, a["id"]),
        )

    # debts (credit cards + family loans)
    for d in read_json("debts.json", []):
        cur.execute(
            """INSERT OR IGNORE INTO debts
               (id,name,kind,counterparty,account,credit_limit,balance,
                due_amount,due_date,note)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (d["id"], d["name"], d["kind"], d.get("counterparty"),
             d.get("account"), d.get("credit_limit"), d.get("balance", 0),
             d.get("due_amount"), d.get("due_date"), d.get("note")),
        )
        # limit/note are config. due_amount/due_date are typed in each cycle from
        # the bank statement via PATCH /api/debt/{id}, so they are NOT re-seeded
        # here — a re-run must not overwrite what you entered on the 3rd.
        cur.execute(
            "UPDATE debts SET name=?, credit_limit=?, note=? WHERE id=?",
            (d["name"], d.get("credit_limit"), d.get("note"), d["id"]),
        )

    # budget → budget_limits + settings.planned_income
    budget = read_json("budget.json", {})
    for cat, limit in (budget.get("monthly") or {}).items():
        cur.execute(
            "INSERT OR IGNORE INTO budget_limits (category,monthly_limit) VALUES (?,?)",
            (cat, limit),
        )
    if "planned_income" in budget:
        cur.execute(
            "INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)",
            ("planned_income", str(budget["planned_income"])),
        )

    # calendar cycle markers → settings.cycle_markers
    # Pure config owned by the seed file, so unlike planned_income this is
    # REPLACEd on every run: editing data/calendar.json and re-seeding is the
    # documented way to change what the calendar marks.
    markers = [
        {
            "day": int(m["day"]),
            "label": str(m.get("label", "")),
            "detail": str(m.get("detail", "")),
            "tone": "due" if m.get("tone") == "due" else "info",
        }
        for m in (read_json("calendar.json", {}).get("markers") or [])
        if 1 <= int(m.get("day", 0)) <= 31
    ]
    cur.execute(
        "INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)",
        ("cycle_markers", json.dumps(markers)),
    )

    conn.commit()


def main():
    reset = "--reset" in sys.argv
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_FILE)
    conn.execute("PRAGMA foreign_keys = ON")
    if reset:
        conn.executescript(DROP)
    conn.executescript(SCHEMA)
    migrate(conn)
    seed(conn)

    # report
    cur = conn.cursor()
    counts = {
        t: cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        for t in ("categories", "accounts", "transactions", "budget_limits")
    }
    conn.close()
    print(f"DB ready → {DB_FILE}")
    for t, n in counts.items():
        print(f"  {t}: {n}")
    print("Transactions start at 0 (by design). Import statements next.")


if __name__ == "__main__":
    main()
