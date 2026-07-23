# Finance Dashboard — Agent Operating Manual

You are the controller for a local-first personal finance dashboard. The user talks to you in plain language; you run the scripts and API below. **Do not re-derive the system from source each time** — the standard actions are documented here. Read `serve.py` only when a task falls outside them.

## Skills

Three skills in `.claude/skills/` (Claude Code auto-loads them; other agents: read the SKILL.md when the trigger matches):
- **finance-ops** — add/edit/delete transactions, accounts, budgets, debts. Wraps *Standard actions* below.
- **finance-import** — ingest bank CSV exports. Wraps *Importing a bank statement* below.
- **finance-analysis** — read-only insight: monthly review, spending trends, cost-cutting. The one net-new capability not in this manual.

The manual below stays the source of truth for ops/import; skills point back to it.

## System shape

- Backend: `serve.py`, Python stdlib only, REST JSON API on `http://127.0.0.1:8787`, binds localhost.
- DB: `data/data.db` (SQLite). All access goes through the `Store` class in `serve.py`.
- Frontend: pre-built in `dist/`, served by `serve.py`. Source in `dashboard/`.
- Derived data (`transactions`) is rebuilt from statements on import. Human edits live in `tx_overrides` and must never be touched by the import pipeline.

## Starting / stopping

```bash
python3 init_db.py        # first run only — create schema + seed
python3 serve.py          # start server (port 8787). Run in background if the user needs it persistent.
```
Check it's up: `curl -s http://127.0.0.1:8787/api/data | head -c 200`

## Standard actions

Prefer the HTTP API over editing the DB directly — the API validates and keeps balances consistent.

**Add a transaction**
```bash
curl -s -X POST http://127.0.0.1:8787/api/transaction \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-01-15","direction":"expense","amount":40.00,"category":"food","account":"revolut","name":"Groceries"}'
```
- `direction`: `income` | `expense` | `internal` (internal = transfer between own accounts; add `"transfer_to":"<account_id>"`).
- `category` must exist in `data/categories.json` **and its type must match `direction`** (an `expense` entry needs an expense category). `account` must exist in `data/accounts.json`. If the user names a new one, add it first (or ask).
- Required fields: `name`, `date` (YYYY-MM-DD), `direction`, `amount` (> 0), `account`, and `category` (except for `internal`, which takes `flow`:`in`|`out` and no category).

**Edit a transaction**
```bash
curl -s -X PATCH http://127.0.0.1:8787/api/transaction/<id> -H 'Content-Type: application/json' -d '{"category":"life"}'
```
Editable: category, account, name, note, direction, transfer_to, flow, refund, amount, date, merchant.

**Delete a transaction**: `DELETE /api/transaction/<id>` (imported rows are tombstoned, not lost).

**Add an account**
```bash
curl -s -X POST http://127.0.0.1:8787/api/account -H 'Content-Type: application/json' \
  -d '{"id":"n26","name":"N26","currency":"EUR","type":"bank","balance":0}'
```

**Set a budget**: `PATCH /api/budget/<category>` body `{"monthly_limit":300}` (null clears).

**Update a debt/credit-card statement figure**: `PATCH /api/debt/<id>` body `{"due_amount":450,"due_date":"2026-01-25"}`.

**Read everything**: `GET /api/data` → `{accounts, transactions, categories, budget, debts, metrics}`. Use this to answer "how much did I spend on X", balances, etc. — filter/aggregate the JSON, don't guess.

## Importing a bank statement

```bash
# user drops the export into Statements/
python3 normalize.py                 # Statements/*.csv → data/normalized.csv
python3 import_csv.py --dry-run      # preview counts, show unmatched
python3 import_csv.py --replace      # commit
```
- If `normalize.py --report` shows an unmatched file, the bank has no profile → write `profiles/<bank>.json` (copy `profiles/revolut.json`). Bank-specific knowledge is **data, never code**.
- Categorization for all banks: `rules/categorize.json` (merchant regex → clean name → category).

## Guardrails

- Never invent account ids, category ids, or amounts. If unclear, ask.
- Never edit `data/data.db` by hand for standard actions — use the API.
- Never write to `tx_overrides` from an import step.
- `init_db.py --reset` and `import_csv.py --replace` are destructive to derived data — confirm with the user first.
- After any write, tell the user to refresh the dashboard (or the UI updates optimistically).
