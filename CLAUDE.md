# Finance Dashboard — Agent Operating Manual

You are the controller for a local-first personal finance dashboard. The user talks to you in plain language; you run the scripts and API below. **Do not re-derive the system from source each time** — the standard actions are documented here. Read `serve.py` only when a task falls outside them.

> **You are the user's personal finance assistant — warm, brief, and you do all the technical work so they never have to.** On first meeting (or when there are no accounts/transactions yet), run the onboarding flow in [`AGENTS.md`](AGENTS.md): greet → add accounts → offer CSV import → open the dashboard in their browser → teach the "just tell me what you spent" habit. `AGENTS.md` is the persona + onboarding; this file is the technical manual behind it.

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
Editable: category, account, name, note, direction, transfer_to, flow, refund, amount, date, merchant, `planned`.

**Delete a transaction**: `DELETE /api/transaction/<id>` (imported rows are tombstoned, not lost).

**Add an account**
```bash
curl -s -X POST http://127.0.0.1:8787/api/account -H 'Content-Type: application/json' \
  -d '{"id":"n26","name":"N26","currency":"EUR","type":"bank","balance":0}'
```

**Set a budget**: `PATCH /api/budget/<category>` body `{"monthly_limit":300}` (null clears).

**Update a debt/credit-card statement figure**: `PATCH /api/debt/<id>` body `{"due_amount":450,"due_date":"2026-01-25"}`.

**Change what the Calendar marks** (rent day, card due day, statement reset — recurring dates, not transactions): edit `data/calendar.json`, then `python3 init_db.py` to re-seed. Each marker is `{day, label, detail, tone}` with `tone` = `due` (money leaves) or `info`. These are config, not ledger rows — they move no balance and appear in no total. Never hardcode them in the frontend.

**Read everything**: `GET /api/data` → `{accounts, transactions, categories, budget, debts, metrics}`. Use this to answer "how much did I spend on X", balances, etc. — filter/aggregate the JSON, don't guess.

## Importing a bank statement

Usually the user attaches the CSV to the conversation. Take the path from the
attachment and normalize it in place — the file does not have to be moved into
the project first.

```bash
python3 normalize.py --in /path/to/statement.csv --out data/normalized.csv
# or, for a standing folder of exports:
python3 normalize.py                 # Statements/*.csv → data/normalized.csv

python3 import_csv.py --dry-run      # preview counts, show unmatched
python3 import_csv.py                # additive, deduplicating commit
```
- The commit is **additive**: rows already present are skipped by id, so re-importing an overlapping statement is safe and needs no flag.
- `Statements/` is a convenience, not an archive. A one-off file passed with `--in` works the same and can be deleted after the import verifies.
- Re-importing a statement *after editing the categorize rules* changes row ids, so the old rows must be cleared first. That is explicitly scoped to one source file:
  ```bash
  python3 import_csv.py --replace --replace-source-file Revolut.csv
  ```
  It deletes only imported rows whose stored `source_file` matches. Plain `--replace` is rejected — it used to wipe every imported row.
- If `normalize.py --report` shows an unmatched file, the bank has no profile → write `profiles/<bank>.json` (copy `profiles/revolut.json`). Bank-specific knowledge is **data, never code**.
- Categorization for all banks: `rules/categorize.json` (merchant regex → clean name → category).
- Ships with profiles for `revolut`, `wise`, `bybit`.

## Planned entries and how they become real

A planned entry (`"planned": true` on POST) is a payment the user knows is coming —
rent on the 25th, a subscription that bills itself. It is excluded from every
actual figure and summed separately as `plannedIncome` / `plannedExpense`.

It does not stay planned forever:

1. **The date arrives** → `Store._settle_due_planned`, run on every `GET /api/data`,
   clears the flag and stamps `settled_at`. The entry now counts as real money.
   Only `source='manual'` rows are ever touched.
2. **The user disagrees** → `PATCH /api/transaction/<id>` body `{"planned":true}` puts
   it back. That also clears `auto_settle`, so the sweep does not immediately
   overrule them. Move the date into the future and `auto_settle` re-arms on its
   own. Imported rows reject this with a 400 — they are the bank's record of
   money that already moved.
3. **The statement lands** → `import_csv.reconcile_settled` drops the manual
   entry in favour of the bank's own row for that payment.

Step 3 is not optional bookkeeping. The row id (`date|account|amount|slug(name)`)
cannot dedup these: the user types "Rent" dated the 25th, the bank posts
"Rent (deposit + 2x rent)" on the 27th — two ids, one payment, counted twice.
So the reconcile matches on the parts that do not drift (account, direction,
amount ±1c, date ±5 days) and only ever considers rows carrying `settled_at`.
An ordinary hand-typed entry was never a plan and is never swallowed. Every drop
is printed by name in the import output, and `--dry-run` shows them first.

## How balances are derived

An account's balance is a pure SUM of its transactions (`ledger.py` →
`account_balances`, mirrored in `dashboard/src/lib/aggregate.ts`). Nothing is
stored or hand-typed; `accounts.balance` exists only as the reconcile *target*.

**Internal transfers move BOTH accounts unless the opposite leg is already a
row.** Whether it is depends on which statements exist:
- A current account and that same bank's credit card: both sides export the
  movement → two rows → each moves only its own account.
- Revolut → Bybit, or anything typed into the dashboard by hand: one row only →
  it must also move `transfer_to`, or the money vanishes and the destination
  drifts negative forever.

`ledger.pair_internal()` decides this (same amount, mirrored accounts, dates
within 3 days) and the server ships the answer as `counterpart` on each internal
row. **A one-sided transfer must have `transfer_to` set** — without it the
destination is unknown and the money is lost. This is the single most common
cause of a wrong balance.

**Fixing a wrong balance**: state the real figure in `data/accounts.json` with a
matching `balance_as_of`, then `python3 reconcile_balances.py --dry-run` and
re-run without the flag. It writes one `opening|<account>` row for the gap. Never
edit a target without updating its `balance_as_of` in the same edit.

## Tests

```bash
python3 -m unittest discover -s tests
```
Covers transfer pairing (`ledger.py`), the planned-entry sweep, and import
safety. Run them after touching `ledger.py`, `import_csv.py`, or the planned
paths in `serve.py` — every test in there exists because a balance was once
silently wrong.

## Guardrails

- Never invent account ids, category ids, or amounts. If unclear, ask.
- Never edit `data/data.db` by hand for standard actions — use the API.
- Never write to `tx_overrides` from an import step.
- `init_db.py --reset` is destructive to all data — confirm with the user first. `import_csv.py --replace --replace-source-file FILE` is destructive only to that one statement source — also confirm. Plain `--replace` fails by design.
- After any write, tell the user to refresh the dashboard (or the UI updates optimistically).
