#!/usr/bin/env python3
"""
Personal-OS dashboard server. Python stdlib only (http.server + sqlite3).

  GET   /api/data              → full snapshot {accounts, transactions, categories,
                                  budget, debts, projects, milestones, streaks, metrics}
  POST  /api/transaction       → add one transaction
  PATCH /api/transaction/{id}   → edit one transaction (category/account/name/…),
                                  or flip `planned` (manual entries only)
  POST  /api/account           → add account
  DELETE /api/account/{id}      → delete an account (refused while anything references it)
  POST  /api/debt              → add a debt (loan / owed-to-me / credit card)
  PATCH /api/debt/{id}          → update a debt (statement figures, name, balance, …)
  DELETE /api/debt/{id}         → delete a debt
  POST  /api/category          → add a category (a budget item)
  DELETE /api/category/{id}     → delete a category (refused while transactions use it)
  PATCH /api/budget/{category}  → set monthly_limit (null clears the budget)
  DELETE /api/transaction/{id}  → delete a transaction (tombstoned if imported)
  POST  /api/project           → add project
  PATCH /api/milestone/{id}     → toggle done (body: {done})
  POST  /api/streak/{key}/ping  → mark streak done today, recompute length
  GET   /*                     → static files from dist/ (SPA fallback to index.html)

Usage: python3 serve.py [port]   (default 8787, binds 127.0.0.1)

All SQL is parametrized (no string concat → no injection). Caddy fronts TLS.
"""

import json
import os
import re
import sqlite3
import sys
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

from ledger import pair_internal

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "data")
DIST_DIR = os.path.join(BASE, "dist")
DB_FILE = os.path.join(DATA_DIR, "data.db")

VALID_DIRECTIONS = {"income", "expense", "internal"}

# Columns the dashboard may edit. `id` and `source` stay owned by the pipeline.
#
# `amount` and `date` ARE editable even though the row id is built from them.
# That is safe precisely because the edit is stored as an override rather than
# written back: the id keeps deriving from the statement's values, so a
# re-import regenerates the same id and the override still lands on it. Writing
# the new amount into the row would change its identity and the next import
# would reinsert the original alongside it as a duplicate.
EDITABLE_TX_FIELDS = {"category", "account", "name", "note", "direction", "transfer_to",
                      "flow", "refund", "amount", "date", "merchant"}
# `planned` is editable too but deliberately NOT in that set: it is the one
# field written straight to the row instead of into tx_overrides. See
# Store.set_planned for why an override would break the date sweep.
VALID_FLOWS = {"in", "out"}
# What the dashboard may write on a debt. `balance` is here so a loan can be
# paid down from the UI — but it is REFUSED on a credit card, whose outstanding
# is derived from the card account's transactions and would only go stale if it
# were also typed in. See update_debt.
EDITABLE_DEBT_FIELDS = {"due_amount", "due_date", "name", "counterparty",
                        "credit_limit", "balance", "note"}
DEBT_NUMERIC_FIELDS = {"due_amount", "credit_limit", "balance"}
VALID_DEBT_KINDS = {"credit_card", "loan", "owed_to_me"}
VALID_ACCOUNT_TYPES = {"bank", "prop_firm", "crypto", "broker", "cash", "credit"}
VALID_CATEGORY_TYPES = {"income", "expense"}
MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
    ".map": "application/json",
}


def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", str(name).lower().strip())
    return s.strip("-") or "tx"


# ── Store ────────────────────────────────────────────────────────────────────
# Thin data layer. Swap this class's guts for Postgres later; nothing else changes.
class Store:
    def __init__(self, db_file=DB_FILE):
        self.db_file = db_file

    def _conn(self):
        conn = sqlite3.connect(self.db_file)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    @staticmethod
    def _rows(cur):
        return [dict(r) for r in cur.fetchall()]

    @staticmethod
    def _overlay(tx, overrides):
        """Apply the dashboard's edit layer + normalize SQLite's ints to JSON types.

        SQLite has no boolean, so `planned` arrives as 0/1. Coercing here, at the
        one boundary every consumer reads through, means no frontend component
        can ever trip on `0 && <Badge/>` rendering a literal 0 again.
        """
        o = overrides.get(tx["id"])
        if o:
            tx.update(o)
        tx["edited"] = bool(o)
        tx["planned"] = bool(tx["planned"])
        tx["refund"] = bool(tx["refund"])
        return tx

    def _load_overrides(self, c):
        return {r["id"]: json.loads(r["fields"]) for r in c.execute("SELECT id, fields FROM tx_overrides")}

    def snapshot(self):
        with self._conn() as c:
            budget_rows = self._rows(c.execute("SELECT category, monthly_limit FROM budget_limits"))
            planned = c.execute("SELECT value FROM settings WHERE key='planned_income'").fetchone()
            markers = c.execute("SELECT value FROM settings WHERE key='cycle_markers'").fetchone()
            overrides = self._load_overrides(c)
            # tombstoned rows never reach the dashboard, and never reach any
            # aggregate computed from it
            txs = self._rows(c.execute(
                """SELECT * FROM transactions
                   WHERE id NOT IN (SELECT id FROM tx_deleted)
                   ORDER BY date DESC, created_at DESC"""))
            # Which internal rows already have their opposite leg in the ledger.
            # Computed here, once, on the overlaid rows (an override can change
            # flow/transfer_to and so change what pairs with what) and shipped as
            # `counterpart` — the dashboard must not re-derive it, or the two
            # definitions drift. See ledger.pair_internal.
            overlaid = [self._overlay(t, overrides) for t in txs]
            self._settle_due_planned(c, overlaid)
            pairs = pair_internal(overlaid)
            for t in overlaid:
                if t["direction"] == "internal":
                    t["counterpart"] = pairs.get(t["id"])

            return {
                # `balance` is deliberately NOT sent. An account's balance is a
                # pure SUM of its transactions, derived in the frontend from the
                # rows below. The stored column survives only as the *target*
                # that reconcile_balances.py diffs against when writing the
                # opening-position adjustment; shipping it here would give the
                # dashboard two disagreeing balances and no way to tell which is
                # real. (It previously shipped it, and it had to be typed in by
                # hand for the numbers to mean anything.)
                "accounts": self._rows(c.execute(
                    "SELECT id, name, type, currency, meta FROM accounts ORDER BY name")),
                "transactions": overlaid,
                "debts": self._rows(c.execute("SELECT * FROM debts ORDER BY kind, name")),
                "categories": self._rows(c.execute("SELECT * FROM categories")),
                "budget": {
                    "monthly": {r["category"]: r["monthly_limit"] for r in budget_rows},
                    "planned_income": float(planned["value"]) if planned else None,
                },
                # Recurring dates the calendar marks (rent, card due, statement
                # reset). Config, not ledger rows — owned by data/calendar.json
                # so anyone can change them without touching the frontend, which
                # is where they used to be hardcoded.
                "cycle_markers": json.loads(markers["value"]) if markers else [],
                "projects": self._rows(c.execute("SELECT * FROM projects ORDER BY id")),
                "milestones": self._rows(c.execute("SELECT * FROM milestones ORDER BY project_id, sort_order")),
                "streaks": self._rows(c.execute("SELECT * FROM streaks")),
                "metrics": self._rows(c.execute("SELECT * FROM metrics")),
            }

    @staticmethod
    def _settle_due_planned(c, overlaid):
        """Turn planned entries into real ones once their date has arrived.

        A planned entry is a payment you know is coming — rent on the 25th, a
        subscription that bills itself. Left alone it stayed 'Planned' forever
        and never counted, because nothing in the system ever cleared the flag.
        Once its date is here the money has moved, so it should count; if it
        genuinely did not, flip it back by hand (set_planned) and the sweep
        stands down.

        Run over the OVERLAID rows, not in SQL, because a dashboard edit to
        `date` lives in tx_overrides — a `WHERE date <= today` against the base
        table would settle on the imported date and ignore the one you can see.

        The mirror of standing down is re-arming: a row you pushed back to a
        future date is a plan again, so auto_settle returns to 1 rather than
        staying suppressed for the rest of that row's life.
        """
        today = date.today().isoformat()
        due, rearm = [], []
        for t in overlaid:
            if not t["planned"] or t["source"] != "manual":
                continue
            if t["date"] > today:
                if not t["auto_settle"]:
                    rearm.append((t["id"],))
            elif t["auto_settle"]:
                due.append((t["id"],))
        if due:
            c.executemany(
                "UPDATE transactions SET planned=0, settled_at=datetime('now') WHERE id=?", due)
            # SQLite's datetime('now') is UTC — match it, or the snapshot and the
            # row disagree by the local offset
            stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            settled = {i for (i,) in due}
            # reflect it in the snapshot being built, so the response the
            # dashboard renders matches what the DB now says
            for t in overlaid:
                if t["id"] in settled:
                    t["planned"], t["settled_at"] = False, stamp
        if rearm:
            c.executemany("UPDATE transactions SET auto_settle=1 WHERE id=?", rearm)

    def set_planned(self, tx_id, planned):
        """Flip a row between Planned and real — written to the row, not tx_overrides.

        Every other edit becomes an override because imported rows are derived
        data that `import_csv.py --replace` rebuilds. `planned` is the exception
        on both counts: only manual rows carry it (the importer always writes 0
        and never rebuilds hand-typed rows), and _settle_due_planned writes the
        base column. An override holding the opposite value would shadow that
        write forever — the row would either never settle, or settle and
        immediately look planned again.

        Flipping back to Planned clears auto_settle so the sweep does not undo
        you on the next page load. Flipping to real stamps settled_at, the same
        marker the sweep leaves, so import_csv.py's reconcile step knows the
        statement's own row for this payment may replace it.
        """
        with self._conn() as c:
            row = c.execute("SELECT source FROM transactions WHERE id=?", (tx_id,)).fetchone()
            if row is None:
                return None
            if row["source"] != "manual":
                return "not-manual"
            if planned:
                c.execute(
                    "UPDATE transactions SET planned=1, auto_settle=0, settled_at=NULL WHERE id=?",
                    (tx_id,))
            else:
                c.execute(
                    "UPDATE transactions SET planned=0, settled_at=datetime('now') WHERE id=?",
                    (tx_id,))
            base = dict(c.execute("SELECT * FROM transactions WHERE id=?", (tx_id,)).fetchone())
            return self._overlay(base, self._load_overrides(c))

    def add_transaction(self, rec):
        with self._conn() as c:
            c.execute(
                """INSERT OR REPLACE INTO transactions
                   (id,date,name,merchant,amount,direction,category,account,
                    transfer_to,flow,refund,note,source,planned)
                   VALUES (:id,:date,:name,:merchant,:amount,:direction,:category,:account,
                           :transfer_to,:flow,:refund,:note,:source,:planned)""",
                rec,
            )
            row = dict(c.execute("SELECT * FROM transactions WHERE id=?", (rec["id"],)).fetchone())
            return self._overlay(row, self._load_overrides(c))

    def update_transaction(self, tx_id, fields):
        """Record a dashboard edit as an override, not an UPDATE.

        The imported rows are derived data — `import_csv.py --replace` wipes and
        rebuilds them after every rules change. Writing the edit into the
        transactions table would lose it there. Writing it into tx_overrides
        instead means the edit outlives any number of re-imports, and the
        importer stays a pure function of the statements + rules.

        An edit that sets a field back to the imported value drops out of the
        override rather than being stored as a no-op, so the layer stays minimal
        and a row reverts to fully-derived once you undo your changes.
        """
        fields = {k: v for k, v in fields.items() if k in EDITABLE_TX_FIELDS}
        if not fields:
            return None
        with self._conn() as c:
            base = c.execute("SELECT * FROM transactions WHERE id=?", (tx_id,)).fetchone()
            if base is None:
                return None
            base = dict(base)
            row = c.execute("SELECT fields FROM tx_overrides WHERE id=?", (tx_id,)).fetchone()
            merged = json.loads(row["fields"]) if row else {}
            merged.update(fields)
            merged = {k: v for k, v in merged.items() if base.get(k) != v}
            if merged:
                c.execute(
                    """INSERT INTO tx_overrides (id,fields,updated_at)
                       VALUES (?,?,datetime('now'))
                       ON CONFLICT(id) DO UPDATE SET
                         fields=excluded.fields, updated_at=excluded.updated_at""",
                    (tx_id, json.dumps(merged, ensure_ascii=False)),
                )
            else:
                c.execute("DELETE FROM tx_overrides WHERE id=?", (tx_id,))
            return self._overlay(base, {tx_id: merged} if merged else {})

    def delete_transaction(self, tx_id):
        """Remove a row from the dashboard for good.

        A manually-added row is genuinely deleted — nothing would bring it back.
        An imported row is tombstoned instead: the transactions table is derived
        from the statements and `import_csv.py --replace` rebuilds it, so a plain
        DELETE would silently undo itself on the next import.

        Either way any override on the row goes with it, so re-importing a
        statement you previously deleted from doesn't resurrect a half-edited row.
        """
        with self._conn() as c:
            row = c.execute("SELECT source FROM transactions WHERE id=?", (tx_id,)).fetchone()
            if row is None:
                return None
            c.execute("DELETE FROM tx_overrides WHERE id=?", (tx_id,))
            c.execute("DELETE FROM transactions WHERE id=?", (tx_id,))
            if row["source"] != "manual":
                c.execute("INSERT OR IGNORE INTO tx_deleted (id) VALUES (?)", (tx_id,))
            return {"id": tx_id, "tombstoned": row["source"] != "manual"}

    def direction_of(self, tx_id):
        """Effective direction (override applied) — for validating a category edit."""
        with self._conn() as c:
            row = c.execute("SELECT direction FROM transactions WHERE id=?", (tx_id,)).fetchone()
            if row is None:
                return None
            ov = c.execute("SELECT fields FROM tx_overrides WHERE id=?", (tx_id,)).fetchone()
            return (json.loads(ov["fields"]).get("direction") if ov else None) or row["direction"]

    def flow_of(self, tx_id):
        """Effective flow (override applied) — an internal row must never end up
        without one, or its account balance silently stops adding up."""
        with self._conn() as c:
            row = c.execute("SELECT flow FROM transactions WHERE id=?", (tx_id,)).fetchone()
            if row is None:
                return None
            ov = c.execute("SELECT fields FROM tx_overrides WHERE id=?", (tx_id,)).fetchone()
            return (json.loads(ov["fields"]).get("flow") if ov else None) or row["flow"]

    def reference(self):
        """{category_id: type} and the set of account ids — for write validation."""
        with self._conn() as c:
            return (
                {r["id"]: r["type"] for r in c.execute("SELECT id, type FROM categories")},
                {r["id"] for r in c.execute("SELECT id FROM accounts")},
            )

    def add_account(self, acc):
        with self._conn() as c:
            c.execute(
                """INSERT OR REPLACE INTO accounts (id,name,type,balance,currency,meta)
                   VALUES (:id,:name,:type,:balance,:currency,:meta)""",
                acc,
            )
            return dict(c.execute("SELECT * FROM accounts WHERE id=?", (acc["id"],)).fetchone())

    def delete_account(self, acc_id):
        """Remove an account — but only once nothing points at it any more.

        Deleting an account that still has transactions would leave rows whose
        balance belongs to nobody: they'd vanish from every account total while
        still counting as income or spend. Same for a debt mapped to the account
        (a credit card without its account has no derivable outstanding). So the
        refusal names what is in the way and the caller clears that first.
        """
        with self._conn() as c:
            if c.execute("SELECT 1 FROM accounts WHERE id=?", (acc_id,)).fetchone() is None:
                return None
            txs = c.execute(
                "SELECT COUNT(*) FROM transactions WHERE account=? OR transfer_to=?",
                (acc_id, acc_id)).fetchone()[0]
            debts = [r["name"] for r in c.execute(
                "SELECT name FROM debts WHERE account=?", (acc_id,))]
            if txs or debts:
                return {"blocked": True, "transactions": txs, "debts": debts}
            c.execute("DELETE FROM accounts WHERE id=?", (acc_id,))
            return {"blocked": False, "id": acc_id}

    def debts(self):
        with self._conn() as c:
            return self._rows(c.execute("SELECT * FROM debts"))

    def add_debt(self, d):
        with self._conn() as c:
            c.execute(
                """INSERT OR REPLACE INTO debts
                   (id,name,kind,counterparty,account,credit_limit,balance,
                    due_amount,due_date,note,updated_at)
                   VALUES (:id,:name,:kind,:counterparty,:account,:credit_limit,:balance,
                           :due_amount,:due_date,:note,datetime('now'))""",
                d,
            )
            return dict(c.execute("SELECT * FROM debts WHERE id=?", (d["id"],)).fetchone())

    def delete_debt(self, debt_id):
        """Delete a debt. The linked account (if any) is left alone — a card's
        transactions are real money that moved and must not disappear with the
        row that summarised them."""
        with self._conn() as c:
            cur = c.execute("DELETE FROM debts WHERE id=?", (debt_id,))
            return {"id": debt_id} if cur.rowcount else None

    def debt_kind(self, debt_id):
        with self._conn() as c:
            row = c.execute("SELECT kind FROM debts WHERE id=?", (debt_id,)).fetchone()
            return row["kind"] if row else None

    def add_category(self, cat):
        with self._conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO categories (id,name,color,type) VALUES (:id,:name,:color,:type)",
                cat,
            )
            return dict(c.execute("SELECT * FROM categories WHERE id=?", (cat["id"],)).fetchone())

    def delete_category(self, cat_id):
        """Delete a category and any budget row on it.

        Refused while transactions still use it: SQLite would either orphan the
        reference or (with foreign_keys ON) fail mid-way, and either way the
        spend those rows represent would stop showing up anywhere. The count is
        returned so the caller can say what is in the way, and the transactions
        can be recategorized first.

        An override that moved a row INTO this category counts too — it is the
        row's effective category, which is the one the dashboard shows.
        """
        with self._conn() as c:
            if c.execute("SELECT 1 FROM categories WHERE id=?", (cat_id,)).fetchone() is None:
                return None
            used = c.execute(
                "SELECT COUNT(*) FROM transactions WHERE category=?", (cat_id,)).fetchone()[0]
            used += sum(1 for r in c.execute("SELECT fields FROM tx_overrides")
                        if json.loads(r["fields"]).get("category") == cat_id)
            if used:
                return {"blocked": True, "transactions": used}
            c.execute("DELETE FROM budget_limits WHERE category=?", (cat_id,))
            c.execute("DELETE FROM categories WHERE id=?", (cat_id,))
            return {"blocked": False, "id": cat_id}

    def update_debt(self, debt_id, fields):
        """Update a debt from the dashboard.

        The statement figures (due_amount / due_date) are not derivable: the
        bank's posting dates differ from transaction dates, and a wrong number
        here has a late fee attached, so they are read off the statement and
        typed in. Name, counterparty, limit, note and — for loans — `balance`
        are plain config the user owns.

        `balance` on a credit card is rejected by the caller, not here: a card's
        outstanding is derived from its account's transactions, so a typed-in
        number would be a second, staler answer to the same question.
        """
        fields = {k: v for k, v in fields.items() if k in EDITABLE_DEBT_FIELDS}
        if not fields:
            return None
        sets = ", ".join(f"{k}=:{k}" for k in fields)
        with self._conn() as c:
            cur = c.execute(
                f"UPDATE debts SET {sets}, updated_at=datetime('now') WHERE id=:id",
                {**fields, "id": debt_id},
            )
            if cur.rowcount == 0:
                return None
            return dict(c.execute("SELECT * FROM debts WHERE id=?", (debt_id,)).fetchone())

    def set_budget(self, category, limit):
        """Set (or clear) one category's monthly budget.

        Upsert rather than UPDATE: a category with no budget yet has no row in
        budget_limits at all, so the first edit from the dashboard has to insert.
        A limit of None deletes the row, which is what "no budget" means here —
        storing 0 instead would render as a category budgeted to zero and
        permanently 'over', rather than one that simply isn't tracked.

        The category is validated against the categories table so a typo can't
        create an orphan row the UI will never show.
        """
        with self._conn() as c:
            known = c.execute("SELECT 1 FROM categories WHERE id=?", (category,)).fetchone()
            if not known:
                return None
            if limit is None:
                c.execute("DELETE FROM budget_limits WHERE category=?", (category,))
            else:
                c.execute(
                    "INSERT INTO budget_limits (category, monthly_limit) VALUES (?,?) "
                    "ON CONFLICT(category) DO UPDATE SET monthly_limit=excluded.monthly_limit",
                    (category, limit),
                )
            rows = c.execute("SELECT category, monthly_limit FROM budget_limits").fetchall()
            return {r["category"]: r["monthly_limit"] for r in rows}

    def add_project(self, p):
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO projects (name,status,start_date,target_date) VALUES (?,?,?,?)",
                (p["name"], p.get("status", "active"), p.get("start_date"), p.get("target_date")),
            )
            return dict(c.execute("SELECT * FROM projects WHERE id=?", (cur.lastrowid,)).fetchone())

    def set_milestone_done(self, milestone_id, done):
        done_at = datetime.now().isoformat(timespec="seconds") if done else None
        with self._conn() as c:
            cur = c.execute(
                "UPDATE milestones SET done=?, done_at=? WHERE id=?",
                (1 if done else 0, done_at, milestone_id),
            )
            if cur.rowcount == 0:
                return None
            return dict(c.execute("SELECT * FROM milestones WHERE id=?", (milestone_id,)).fetchone())

    def ping_streak(self, key):
        today = date.today().isoformat()
        with self._conn() as c:
            row = c.execute("SELECT * FROM streaks WHERE key=?", (key,)).fetchone()
            if row is None:
                c.execute(
                    "INSERT INTO streaks (key,last_done,current_len,best_len) VALUES (?,?,1,1)",
                    (key, today),
                )
            else:
                if row["last_done"] == today:
                    return dict(c.execute("SELECT * FROM streaks WHERE key=?", (key,)).fetchone())
                yesterday = (date.today() - timedelta(days=1)).isoformat()
                current = row["current_len"] + 1 if row["last_done"] == yesterday else 1
                best = max(current, row["best_len"])
                c.execute(
                    "UPDATE streaks SET last_done=?, current_len=?, best_len=? WHERE key=?",
                    (today, current, best, key),
                )
            return dict(c.execute("SELECT * FROM streaks WHERE key=?", (key,)).fetchone())


STORE = Store()


# ── HTTP ─────────────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # quiet

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return None

    # ── GET ──────────────────────────────────────────────────────────────────
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/data":
            return self._send_json(STORE.snapshot())
        if path.startswith("/api/"):
            return self._send_json({"error": "not found"}, 404)
        return self._serve_static(path)

    def _serve_static(self, path):
        rel = path.lstrip("/") or "index.html"
        target = os.path.normpath(os.path.join(DIST_DIR, rel))
        if not target.startswith(DIST_DIR):  # prevent path traversal
            return self._send_json({"error": "forbidden"}, 403)
        if not os.path.isfile(target):
            target = os.path.join(DIST_DIR, "index.html")  # SPA fallback
        if not os.path.isfile(target):
            return self._send_json({"error": "dist/ not built — run: cd dashboard && npm run build"}, 404)
        ext = os.path.splitext(target)[1].lower()
        with open(target, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ── POST ─────────────────────────────────────────────────────────────────
    def do_POST(self):
        path = self.path.split("?", 1)[0]
        body = self._read_body()
        if body is None:
            return self._send_json({"error": "invalid JSON"}, 400)

        if path == "/api/transaction":
            return self._add_transaction(body)
        if path == "/api/account":
            return self._add_account(body)
        if path == "/api/debt":
            return self._add_debt(body)
        if path == "/api/category":
            return self._add_category(body)
        if path == "/api/project":
            return self._add_project(body)
        m = re.match(r"^/api/streak/([^/]+)/ping$", path)
        if m:
            return self._send_json({"ok": True, "streak": STORE.ping_streak(m.group(1))})
        return self._send_json({"error": "not found"}, 404)

    # ── DELETE ───────────────────────────────────────────────────────────────
    def do_DELETE(self):
        path = self.path.split("?", 1)[0]
        m = re.match(r"^/api/transaction/(.+)$", path)
        if m:
            res = STORE.delete_transaction(unquote(m.group(1)))
            return self._send_json({"ok": True, **res}) if res \
                else self._send_json({"error": "transaction not found"}, 404)

        m = re.match(r"^/api/account/([^/]+)$", path)
        if m:
            res = STORE.delete_account(unquote(m.group(1)))
            if res is None:
                return self._send_json({"error": "account not found"}, 404)
            if res["blocked"]:
                # 409, not 400: the request is well-formed, the state is what
                # refuses it — and the message says exactly what to clear.
                bits = []
                if res["transactions"]:
                    bits.append(f"{res['transactions']} transaction(s) use it")
                if res["debts"]:
                    bits.append("linked to debt: " + ", ".join(res["debts"]))
                return self._send_json(
                    {"error": "cannot delete this account — " + "; ".join(bits)}, 409)
            return self._send_json({"ok": True, "id": res["id"]})

        m = re.match(r"^/api/debt/([^/]+)$", path)
        if m:
            res = STORE.delete_debt(unquote(m.group(1)))
            return self._send_json({"ok": True, **res}) if res \
                else self._send_json({"error": "debt not found"}, 404)

        m = re.match(r"^/api/category/([^/]+)$", path)
        if m:
            res = STORE.delete_category(unquote(m.group(1)))
            if res is None:
                return self._send_json({"error": "category not found"}, 404)
            if res["blocked"]:
                return self._send_json(
                    {"error": f"cannot delete this category — {res['transactions']} "
                              f"transaction(s) use it. Recategorize them first, or clear "
                              f"the budget instead of deleting."}, 409)
            return self._send_json({"ok": True, "id": res["id"]})

        return self._send_json({"error": "not found"}, 404)

    # ── PATCH ────────────────────────────────────────────────────────────────
    def do_PATCH(self):
        path = self.path.split("?", 1)[0]
        body = self._read_body()
        if body is None:
            return self._send_json({"error": "invalid JSON"}, 400)

        m = re.match(r"^/api/transaction/(.+)$", path)
        if m:
            return self._update_transaction(unquote(m.group(1)), body)

        # PATCH /api/account/{id} (set balance) is gone on purpose. Balances are
        # derived from transactions now, so an endpoint that wrote one would be
        # writing a number nothing reads. To correct a balance, add the missing
        # transaction — or fix the target in data/accounts.json and re-run
        # reconcile_balances.py.

        m = re.match(r"^/api/debt/([^/]+)$", path)
        if m:
            debt_id = unquote(m.group(1))
            fields = {k: v for k, v in body.items() if k in EDITABLE_DEBT_FIELDS}
            if not fields:
                return self._send_json(
                    {"error": f"no editable fields; allowed: {sorted(EDITABLE_DEBT_FIELDS)}"}, 400)
            err = self._clean_debt_fields(fields)
            if err:
                return self._send_json({"error": err}, 400)
            if "balance" in fields and STORE.debt_kind(debt_id) == "credit_card":
                return self._send_json(
                    {"error": "a credit card's balance is derived from its account's "
                              "transactions and cannot be set here"}, 400)
            if "name" in fields and not str(fields["name"]).strip():
                return self._send_json({"error": "name cannot be empty"}, 400)
            debt = STORE.update_debt(debt_id, fields)
            return self._send_json({"ok": True, "debt": debt}) if debt \
                else self._send_json({"error": "debt not found"}, 404)

        m = re.match(r"^/api/budget/([^/]+)$", path)
        if m:
            if "monthly_limit" not in body:
                return self._send_json({"error": "monthly_limit required"}, 400)
            raw = body["monthly_limit"]
            if raw is None or raw == "":
                limit = None            # clearing the budget removes the row
            else:
                try:
                    limit = round(float(raw), 2)
                except (TypeError, ValueError):
                    return self._send_json({"error": "monthly_limit must be a number"}, 400)
                if limit < 0:
                    return self._send_json({"error": "monthly_limit cannot be negative"}, 400)
            monthly = STORE.set_budget(unquote(m.group(1)), limit)
            return self._send_json({"ok": True, "monthly": monthly}) if monthly is not None \
                else self._send_json({"error": "unknown category"}, 404)

        m = re.match(r"^/api/milestone/([^/]+)$", path)
        if m:
            ms = STORE.set_milestone_done(int(m.group(1)), bool(body.get("done")))
            return self._send_json({"ok": True, "milestone": ms}) if ms \
                else self._send_json({"error": "milestone not found"}, 404)

        return self._send_json({"error": "not found"}, 404)

    # ── handlers ─────────────────────────────────────────────────────────────
    def _add_transaction(self, body):
        name = str(body.get("name", "")).strip()
        tx_date = str(body.get("date", "")).strip()
        direction = str(body.get("direction", "")).strip()
        category = str(body.get("category", "")).strip()
        account = str(body.get("account", "")).strip()
        try:
            amount = round(float(body.get("amount")), 2)
        except (TypeError, ValueError):
            return self._send_json({"error": "amount must be a number"}, 400)

        transfer_to = str(body.get("transfer_to", "")).strip()
        flow = str(body.get("flow", "")).strip()
        refund = body.get("refund") is True
        cat_type, accounts = STORE.reference()

        errors = []
        if not name: errors.append("name required")
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", tx_date): errors.append("date must be YYYY-MM-DD")
        if amount <= 0: errors.append("amount must be > 0")
        if direction not in VALID_DIRECTIONS: errors.append("direction must be income|expense|internal")
        if account not in accounts: errors.append(f"unknown account '{account}'")
        if transfer_to and transfer_to not in accounts:
            errors.append(f"unknown transfer_to account '{transfer_to}'")
        # internal transfers carry no category — counting them as income/expense
        # is what double-counts every move. They do need `flow`: `direction` is
        # 'internal' for both legs, so without it the row is unsigned and the
        # account balance derived from it is meaningless.
        if direction == "internal":
            category = ""
            refund = False
            if flow not in VALID_FLOWS:
                errors.append("internal transfers need flow=in|out (which way the money moved)")
        else:
            flow = ""
            if not category:
                errors.append("category required")
            elif category not in cat_type:
                errors.append(f"unknown category '{category}'")
            elif cat_type[category] != direction:
                errors.append(f"'{category}' is a {cat_type[category]} category; entry is {direction}")
            # a refund is money returning on a spend, so it is an expense row
            # that counts negatively — never an income row
            if refund and direction != "expense":
                errors.append("refund only applies to expense entries")
        if errors:
            return self._send_json({"error": "; ".join(errors)}, 400)

        rec = {
            # same shape import_csv.py's row_id() builds, so a manually-added row
            # that later turns up in a statement export dedups against it instead
            # of landing twice under two different id formats
            "id": f"{tx_date}|{account}|{amount}|{slugify(name)[:40]}",
            "date": tx_date, "name": name, "merchant": body.get("merchant") or name,
            "amount": amount, "direction": direction, "category": category or None,
            "account": account, "transfer_to": transfer_to or None,
            "flow": flow or None, "refund": 1 if refund else 0,
            "note": body.get("note"),
            "source": body.get("source", "manual"),
            "planned": 1 if body.get("planned") is True else 0,
        }
        return self._send_json({"ok": True, "transaction": STORE.add_transaction(rec)})

    def _update_transaction(self, tx_id, body):
        # `planned` takes the direct-write path, so it is handled before the
        # override machinery and never mixed into `fields`.
        if "planned" in body:
            if not isinstance(body["planned"], bool):
                return self._send_json({"error": "planned must be true or false"}, 400)
            tx = STORE.set_planned(tx_id, body["planned"])
            if tx is None:
                return self._send_json({"error": "transaction not found"}, 404)
            if tx == "not-manual":
                # An imported row is the statement's record of money that already
                # moved. Calling it 'planned' would remove real spending from
                # every total, and the next import would put it back anyway.
                return self._send_json(
                    {"error": "only manually-added entries can be planned"}, 400)
            if len(body) == 1:
                return self._send_json({"ok": True, "transaction": tx})

        fields = {k: v for k, v in body.items() if k in EDITABLE_TX_FIELDS}
        if not fields:
            return self._send_json(
                {"error": f"no editable fields; allowed: {sorted(EDITABLE_TX_FIELDS | {'planned'})}"},
                400)

        cat_type, accounts = STORE.reference()
        direction = fields.get("direction")
        if direction is not None and direction not in VALID_DIRECTIONS:
            return self._send_json({"error": "direction must be income|expense|internal"}, 400)
        for key in ("account", "transfer_to"):
            if fields.get(key) and fields[key] not in accounts:
                return self._send_json({"error": f"unknown account '{fields[key]}'"}, 400)

        if fields.get("flow") and fields["flow"] not in VALID_FLOWS:
            return self._send_json({"error": "flow must be in|out"}, 400)

        if "amount" in fields:
            try:
                fields["amount"] = round(float(fields["amount"]), 2)
            except (TypeError, ValueError):
                return self._send_json({"error": "amount must be a number"}, 400)
            if fields["amount"] <= 0:
                # the sign lives in direction/flow/refund; a negative amount here
                # would flip a total in a way nothing else in the app expects
                return self._send_json({"error": "amount must be > 0"}, 400)
        if "date" in fields and not re.match(r"^\d{4}-\d{2}-\d{2}$", str(fields["date"])):
            return self._send_json({"error": "date must be YYYY-MM-DD"}, 400)
        if "name" in fields and not str(fields["name"]).strip():
            return self._send_json({"error": "name cannot be empty"}, 400)
        if "refund" in fields:
            fields["refund"] = 1 if fields["refund"] else 0
            if fields["refund"] and (direction or STORE.direction_of(tx_id)) != "expense":
                return self._send_json({"error": "refund only applies to expense entries"}, 400)

        # Switching a row to/from 'internal' has to carry its bookkeeping with
        # it, or the row is left in a state the POST path would have rejected:
        # an internal row without `flow` is unsigned, and one that kept its
        # category would be counted as spend as well as movement.
        if direction == "internal":
            fields["category"] = None
            fields["refund"] = 0
            if not (fields.get("flow") or STORE.flow_of(tx_id)):
                return self._send_json(
                    {"error": "internal transfers need flow=in|out (which way the money moved)"},
                    400)
        elif direction in ("income", "expense"):
            fields["flow"] = None
            fields["transfer_to"] = None

        category = fields.get("category")
        if category:
            if category not in cat_type:
                return self._send_json({"error": f"unknown category '{category}'"}, 400)
            # same guard import_csv.py applies: an income row must not land in an
            # expense-typed category. Without this the dashboard becomes a way to
            # create exactly the data the importer refuses to accept.
            effective = direction or STORE.direction_of(tx_id)
            if effective in ("income", "expense") and cat_type[category] != effective:
                return self._send_json(
                    {"error": f"'{category}' is a {cat_type[category]} category; "
                              f"this transaction is {effective}"}, 400)

        tx = STORE.update_transaction(tx_id, fields)
        return self._send_json({"ok": True, "transaction": tx}) if tx \
            else self._send_json({"error": "transaction not found"}, 404)

    def _add_account(self, body):
        acc_id = str(body.get("id", "")).strip() or slugify(body.get("name", ""))
        name = str(body.get("name", "")).strip()
        if not name:
            return self._send_json({"error": "name required"}, 400)
        acc_type = str(body.get("type") or "bank")
        if acc_type not in VALID_ACCOUNT_TYPES:
            return self._send_json(
                {"error": f"type must be one of {sorted(VALID_ACCOUNT_TYPES)}"}, 400)
        try:
            balance = round(float(body.get("balance", 0)), 2)
        except (TypeError, ValueError):
            return self._send_json({"error": "balance must be a number"}, 400)
        # The id is derived from the name, so two accounts called the same thing
        # collide. INSERT OR REPLACE would silently overwrite the first one and
        # take its transactions with it, so a taken id is an error, not a merge.
        _, existing = STORE.reference()
        if acc_id in existing:
            return self._send_json(
                {"error": f"an account with id '{acc_id}' already exists — pick another name"}, 409)
        meta = body.get("meta", {})
        acc = {
            "id": acc_id, "name": name, "type": acc_type,
            "balance": balance, "currency": body.get("currency") or "EUR",
            "meta": json.dumps(meta) if isinstance(meta, (dict, list)) else str(meta),
        }
        return self._send_json({"ok": True, "account": STORE.add_account(acc)})

    @staticmethod
    def _clean_debt_fields(fields):
        """Coerce and range-check a debt's numeric/date fields in place.

        Returns an error string, or None when the fields are good. Shared by the
        create and update paths so a debt cannot be born in a shape the update
        path would reject.
        """
        for key in DEBT_NUMERIC_FIELDS & set(fields):
            if fields[key] is None or fields[key] == "":
                fields[key] = None
                continue
            try:
                fields[key] = round(float(fields[key]), 2)
            except (TypeError, ValueError):
                return f"{key} must be a number"
            if fields[key] < 0:
                return f"{key} cannot be negative"
        if fields.get("due_date") and not re.match(r"^\d{4}-\d{2}-\d{2}$", str(fields["due_date"])):
            return "due_date must be YYYY-MM-DD"
        return None

    def _add_debt(self, body):
        name = str(body.get("name", "")).strip()
        kind = str(body.get("kind", "")).strip()
        if not name:
            return self._send_json({"error": "name required"}, 400)
        if kind not in VALID_DEBT_KINDS:
            return self._send_json(
                {"error": f"kind must be one of {sorted(VALID_DEBT_KINDS)}"}, 400)

        account = str(body.get("account") or "").strip()
        _, accounts = STORE.reference()
        if account and account not in accounts:
            return self._send_json({"error": f"unknown account '{account}'"}, 400)
        # A credit card's outstanding is the negative of its account balance, so
        # a card with no account has nothing to derive from and would sit at a
        # frozen, hand-typed number forever.
        if kind == "credit_card" and not account:
            return self._send_json(
                {"error": "a credit card must be linked to an account of type 'credit'"}, 400)

        fields = {k: body.get(k) for k in ("credit_limit", "balance", "due_amount", "due_date")}
        err = self._clean_debt_fields(fields)
        if err:
            return self._send_json({"error": err}, 400)

        base = slugify(body.get("id") or name)
        existing = {d["id"] for d in STORE.debts()}
        debt_id, n = base, 2
        while debt_id in existing:      # two "Mum" loans are a normal thing to have
            debt_id, n = f"{base}-{n}", n + 1

        rec = {
            "id": debt_id, "name": name, "kind": kind,
            "counterparty": str(body.get("counterparty") or "").strip() or None,
            "account": account or None,
            "credit_limit": fields["credit_limit"],
            # a card's stored balance is never read (cardOutstanding derives it),
            # so it is pinned at 0 rather than left to look authoritative
            "balance": 0 if kind == "credit_card" else (fields["balance"] or 0),
            "due_amount": fields["due_amount"], "due_date": fields["due_date"] or None,
            "note": str(body.get("note") or "").strip() or None,
        }
        return self._send_json({"ok": True, "debt": STORE.add_debt(rec)})

    def _add_category(self, body):
        """Add a category — which is what a 'budget item' is.

        A budget row is a limit ON a category, so there is nothing to budget
        until the category exists. `monthly_limit` is optional and applied after
        the insert, which is why the response carries both.
        """
        name = str(body.get("name", "")).strip()
        if not name:
            return self._send_json({"error": "name required"}, 400)
        cat_type = str(body.get("type") or "expense")
        if cat_type not in VALID_CATEGORY_TYPES:
            return self._send_json({"error": "type must be income or expense"}, 400)
        cat_id = slugify(body.get("id") or name)
        cat_types, _ = STORE.reference()
        if cat_id in cat_types:
            return self._send_json(
                {"error": f"a category with id '{cat_id}' already exists"}, 409)
        color = str(body.get("color") or "").strip()
        if not re.match(r"^#[0-9a-fA-F]{6}$", color):
            color = "#8a7f70"           # neutral; the user can recolor in the JSON seed
        cat = {"id": cat_id, "name": name, "color": color, "type": cat_type}
        created = STORE.add_category(cat)

        monthly = None
        raw = body.get("monthly_limit")
        if raw not in (None, ""):
            try:
                limit = round(float(raw), 2)
            except (TypeError, ValueError):
                return self._send_json({"error": "monthly_limit must be a number"}, 400)
            if limit < 0:
                return self._send_json({"error": "monthly_limit cannot be negative"}, 400)
            monthly = STORE.set_budget(cat_id, limit)
        return self._send_json({"ok": True, "category": created, "monthly": monthly})

    def _add_project(self, body):
        name = str(body.get("name", "")).strip()
        if not name:
            return self._send_json({"error": "name required"}, 400)
        return self._send_json({"ok": True, "project": STORE.add_project(body)})


def main():
    # Host/port from env (Docker sets DASH_HOST=0.0.0.0 so Caddy can reach it).
    # Default stays 127.0.0.1 → local tier is localhost-only, never exposed.
    host = os.environ.get("DASH_HOST", "127.0.0.1")
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("DASH_PORT", "8787"))
    if not os.path.isfile(DB_FILE):
        print(f"WARNING: {DB_FILE} missing — run: python3 init_db.py")
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Personal-OS dashboard → http://{host}:{port}")
    print(f"  db:   {DB_FILE}")
    print(f"  dist: {DIST_DIR}{'' if os.path.isdir(DIST_DIR) else '  (not built — API still works for dev)'}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
