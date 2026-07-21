#!/usr/bin/env python3
"""
Personal-OS dashboard server. Python stdlib only (http.server + sqlite3).

  GET   /api/data              → full snapshot {accounts, transactions, categories,
                                  budget, debts, projects, milestones, streaks, metrics}
  POST  /api/transaction       → add one transaction
  PATCH /api/transaction/{id}   → edit one transaction (category/account/name/…)
  POST  /api/account           → add account
  PATCH /api/debt/{id}          → update statement figures (due_amount, due_date)
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
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

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
VALID_FLOWS = {"in", "out"}
# A credit card's outstanding balance is derived from its account's transactions,
# so it is deliberately not editable here — only the statement figures are.
EDITABLE_DEBT_FIELDS = {"due_amount", "due_date"}
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
            overrides = self._load_overrides(c)
            # tombstoned rows never reach the dashboard, and never reach any
            # aggregate computed from it
            txs = self._rows(c.execute(
                """SELECT * FROM transactions
                   WHERE id NOT IN (SELECT id FROM tx_deleted)
                   ORDER BY date DESC, created_at DESC"""))
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
                "transactions": [self._overlay(t, overrides) for t in txs],
                "debts": self._rows(c.execute("SELECT * FROM debts ORDER BY kind, name")),
                "categories": self._rows(c.execute("SELECT * FROM categories")),
                "budget": {
                    "monthly": {r["category"]: r["monthly_limit"] for r in budget_rows},
                    "planned_income": float(planned["value"]) if planned else None,
                },
                "projects": self._rows(c.execute("SELECT * FROM projects ORDER BY id")),
                "milestones": self._rows(c.execute("SELECT * FROM milestones ORDER BY project_id, sort_order")),
                "streaks": self._rows(c.execute("SELECT * FROM streaks")),
                "metrics": self._rows(c.execute("SELECT * FROM metrics")),
            }

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

    def update_debt(self, debt_id, fields):
        """Update the statement figures on a debt (due_amount / due_date).

        These are the only debt fields the dashboard writes. A credit card's
        outstanding balance is NOT among them — that is derived from the card
        account's transactions. The statement due is not derivable: the bank's
        posting dates differ from transaction dates, and a wrong number here has
        a late fee attached, so it is read off the statement and typed in.
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
            fields = {k: v for k, v in body.items() if k in EDITABLE_DEBT_FIELDS}
            if not fields:
                return self._send_json(
                    {"error": f"no editable fields; allowed: {sorted(EDITABLE_DEBT_FIELDS)}"}, 400)
            if "due_amount" in fields and fields["due_amount"] is not None:
                try:
                    fields["due_amount"] = round(float(fields["due_amount"]), 2)
                except (TypeError, ValueError):
                    return self._send_json({"error": "due_amount must be a number"}, 400)
                if fields["due_amount"] < 0:
                    return self._send_json({"error": "due_amount cannot be negative"}, 400)
            if fields.get("due_date") and not re.match(r"^\d{4}-\d{2}-\d{2}$", str(fields["due_date"])):
                return self._send_json({"error": "due_date must be YYYY-MM-DD"}, 400)
            debt = STORE.update_debt(m.group(1), fields)
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
        fields = {k: v for k, v in body.items() if k in EDITABLE_TX_FIELDS}
        if not fields:
            return self._send_json(
                {"error": f"no editable fields; allowed: {sorted(EDITABLE_TX_FIELDS)}"}, 400)

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
        try:
            balance = round(float(body.get("balance", 0)), 2)
        except (TypeError, ValueError):
            return self._send_json({"error": "balance must be a number"}, 400)
        meta = body.get("meta", {})
        acc = {
            "id": acc_id, "name": name, "type": body.get("type", "bank"),
            "balance": balance, "currency": body.get("currency", "EUR"),
            "meta": json.dumps(meta) if isinstance(meta, (dict, list)) else str(meta),
        }
        return self._send_json({"ok": True, "account": STORE.add_account(acc)})

    def _add_project(self, body):
        name = str(body.get("name", "")).strip()
        if not name:
            return self._send_json({"error": "name required"}, 400)
        return self._send_json({"ok": True, "project": STORE.add_project(body)})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    if not os.path.isfile(DB_FILE):
        print(f"WARNING: {DB_FILE} missing — run: python3 init_db.py")
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Personal-OS dashboard → http://127.0.0.1:{port}")
    print(f"  db:   {DB_FILE}")
    print(f"  dist: {DIST_DIR}{'' if os.path.isdir(DIST_DIR) else '  (not built — API still works for dev)'}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
