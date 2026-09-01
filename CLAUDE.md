# Finance Dashboard — Agent Operating Manual

You are the controller for a local-first personal finance dashboard. The user talks to you in plain language; you run the scripts and API below. **Do not re-derive the system from source each time** — the standard actions are documented here. Read `serve.py` only when a task falls outside them.

> **Read both files.** This one is the technical manual: API, scripts, exact fields, guardrails. [`AGENTS.md`](AGENTS.md) is the persona, the five-step onboarding script, and the rules of engagement with the user. They are two halves of one manual, not two formats of the same one — different tools load different files (Claude Code always loads `CLAUDE.md`; Codex, Cursor and anything following the AGENTS.md convention load `AGENTS.md`; some load neither on their own). **Whichever one you were given, open the other before you act.**
>
> **You are the user's personal finance assistant — warm, brief, and you do all the technical work so they never have to.** On first meeting (or when there are no accounts/transactions yet), run the onboarding in `AGENTS.md`: accounts → categories → import one statement at a time → check and set budgets → hand over the monthly routine. Never make the user read either file.

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

**Always start the server with `./start.sh`. Never with `python3 serve.py &`.**

```bash
./start.sh                # start (idempotent — says so if it is already up)
./start.sh --status       # is it up?
./stop.sh                 # stop it
```

`start.sh` creates the database on first run, launches the server detached with
`nohup` (own process group where the OS has `setsid`), writes `data/server.pid`
and `data/server.log`, and does not report success until `GET /api/data`
actually answers.

This matters, and it is the one setup mistake that keeps getting made: a bare
`python3 serve.py &` from a tool call, a setup script, or an SSH command is a
**child of that shell**. The health check passes, you report the dashboard is
running, and the process dies the moment your session ends — the user opens the
link ten minutes later and gets a connection error. `start.sh` is what makes
"it started" and "it is still up tomorrow" the same statement.

If you cannot run `start.sh` (no shell on the user's machine), tell them to run
it themselves — do not substitute a backgrounded command of your own.

Check it's up: `curl -s http://127.0.0.1:8787/api/data | head -c 200`

On a server, `docker compose up -d` already runs it as a restart-on-reboot
container; `start.sh` is for the local tier.

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
  -d '{"name":"N26","currency":"EUR","type":"bank"}'
```
`type`: `bank` | `cash` | `credit` | `broker` | `crypto` | `prop_firm`. The id is slugified from the name; a taken id is a 409, not a silent overwrite. **Do not pass a starting balance** — balances are summed from transactions, so book the opening amount as one `internal` row instead (`{"direction":"internal","flow":"in","account":"<id>","name":"Opening balance", …}`, no `transfer_to`). Booking it as income would put the user's existing savings into this month's earnings.

**Delete an account**: `DELETE /api/account/<id>`. Refused with 409 while transactions reference it or a debt is mapped to it; the error names what is in the way.

**Set a budget**: `PATCH /api/budget/<category>` body `{"monthly_limit":300}` (null clears).

**Add a budget item** (= a category; a budget is a limit ON a category, so the category has to exist first)
```bash
curl -s -X POST http://127.0.0.1:8787/api/category -H 'Content-Type: application/json' \
  -d '{"name":"Pets","type":"expense","monthly_limit":60}'
```

**Delete a category**: `DELETE /api/category/<id>` — takes its budget row with it. Refused with 409 while any transaction uses it (recategorize them first, or just clear the limit).

**Add a debt**
```bash
curl -s -X POST http://127.0.0.1:8787/api/debt -H 'Content-Type: application/json' \
  -d '{"name":"Loan from Mum","kind":"loan","counterparty":"Mum","balance":300}'
```
`kind`: `loan` | `owed_to_me` | `credit_card`. A `credit_card` **must** carry `account` (an account of type `credit`) — its outstanding is derived from that account's transactions, and its stored `balance` is pinned at 0 and never read.

**Update a debt**: `PATCH /api/debt/<id>` — `due_amount`, `due_date`, `name`, `counterparty`, `credit_limit`, `note`, and `balance`. `balance` is how a loan gets paid down; it is **rejected on a credit card** (derived, see above).

**Delete a debt**: `DELETE /api/debt/<id>`. Transactions and the linked account are untouched.

**Change what the Calendar marks** (rent day, card due day, statement reset — recurring dates, not transactions): edit `data/calendar.json`, then `python3 init_db.py` to re-seed. Each marker is `{day, label, detail, tone}` with `tone` = `due` (money leaves) or `info`. These are config, not ledger rows — they move no balance and appear in no total. Never hardcode them in the frontend.

**Read everything**: `GET /api/data` → `{accounts, transactions, categories, budget, debts, metrics}`. Use this to answer "how much did I spend on X", balances, etc. — filter/aggregate the JSON, don't guess.

## Importing a bank statement

**One statement per import cycle.** `normalize.py` exits with an error when it
is pointed at a directory holding more than one CSV, and `import_csv.py` refuses
to commit when 30% or more of the incoming non-transfer rows carry no category.
Both guards exist because of the same real failure: four exports normalized in
one run, committed in one go, and every row landing uncategorized — the totals
still add up, the dashboard looks populated, and nobody notices for a month. A
batch import is not faster; it just moves the work to where it is invisible.

Usually the user attaches the CSV to the conversation. Take the path from the
attachment and normalize it in place — the file does not have to be moved into
the project first.

```bash
python3 normalize.py --in /path/to/statement.csv --out data/normalized.csv
# or, for a standing folder holding exactly one export:
python3 normalize.py                 # Statements/*.csv → data/normalized.csv

python3 import_csv.py --dry-run      # preview counts, show unmatched
python3 import_csv.py                # additive, deduplicating commit
```

Then repeat the whole cycle for the next file. The full per-file loop, including
what to say to the user at each point, is in `AGENTS.md` → *Step 3*.

### The categorization gate

`normalize.py` always prints an `UNCATEGORIZED` block when rows matched no rule:
a count and the top unmatched payees. **Read it, and act on it before importing**
— that block is the only signal that the import is about to fill the dashboard
with unsorted rows.

The fix is never to categorize the rows after the fact one by one. It is to add
merchant rules to `rules/categorize.json`, so the same payee is silent forever
after:

```jsonc
"merchants": { "billa|tesco|lidl": "Groceries" },   // raw string → clean name
"categories": { "food": ["groceries", "restaurant"] }  // clean name → category id
```

Patterns are regex, matched against a diacritics-stripped, lowercased
`name merchant` haystack — write them without accents. Confirm the mapping with
the user in plain language first (group the payees; do not ask row by row), then
re-run `normalize.py` and check the count dropped.

Escape hatches, both for the rare case where the guard is genuinely wrong:
`normalize.py --allow-multi` and `import_csv.py --allow-uncategorized`. Neither
is a way to get past a failing import — if you are reaching for one, the rules
are what need fixing.
- The commit is **additive**: rows already present are skipped by id, so re-importing an overlapping statement is safe and needs no flag.
- `Statements/` is a convenience, not an archive. A one-off file passed with `--in` works the same and can be deleted after the import verifies.
- Re-importing a statement *after editing the categorize rules* changes row ids, so the old rows must be cleared first. That is explicitly scoped to one source file:
  ```bash
  python3 import_csv.py --replace --replace-source-file Revolut.csv
  ```
  It deletes only imported rows whose stored `source_file` matches. Plain `--replace` is rejected — it used to wipe every imported row.
- If `normalize.py --report` shows an unmatched file, the bank has no profile → write `profiles/<bank>.json` (copy `profiles/revolut.json`). Bank-specific knowledge is **data, never code**.
- Categorization for all banks: `rules/categorize.json` (merchant regex → clean name → category).
- Ships with profiles for `revolut` and `wise`.

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
- One statement per import cycle. Never batch, and never route around `--allow-multi` / `--allow-uncategorized` to make an import go through.
- Every categorization the user corrects becomes a rule in `rules/categorize.json`, not just an edited row — otherwise the same question comes back next month.
- Never edit `data/data.db` by hand for standard actions — use the API.
- Never write to `tx_overrides` from an import step.
- `init_db.py --reset` is destructive to all data — confirm with the user first. `import_csv.py --replace --replace-source-file FILE` is destructive only to that one statement source — also confirm. Plain `--replace` fails by design.
- After any write, tell the user to refresh the dashboard (or the UI updates optimistically).
