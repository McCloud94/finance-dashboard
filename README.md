# Personal Finance Dashboard

**Get organized and keep perfect clarity and control over your finances — on about 15 minutes of work a month.**

A private, intelligent money dashboard that lives on your computer. You tell an AI what you need — import a bank statement at the end of the month, add a transaction, ask a question about your finances — and it does the rest.

No spreadsheets or apps, no logins.

- **Your data stays yours.** One SQLite file on your machine. No cloud account, no signup, no API keys.
- **Zero backend dependencies.** The server is Python standard library only.
- **Bank-agnostic import.** Adding support for a new bank = writing one small JSON profile, never touching code. Ships with profiles for Revolut and Wise.
- **Runs offline.** Everything is on `localhost`.
- **Plan ahead.** Mark a payment you know is coming as planned; it stays out of your totals until its date arrives, then counts itself — and steps aside when the bank's own row for it turns up.

---

## Architecture

```
Browser (phone/desktop)  ──HTTP──>  serve.py (Python stdlib)  ──>  data/data.db (SQLite)
                                          ▲
AI agent (Claude Code / Hermes) ──────────┘  reads & writes the same DB + repo files
```

The dashboard is a **view**. The AI agent is the **controller** — it runs the same scripts and API you could run by hand, but you never have to. See [`CLAUDE.md`](CLAUDE.md) for the agent's operating manual.

---

## Quick start

Requirements: Python 3.9+, and (optionally) Node 18+ if you want to rebuild the frontend. A pre-built frontend ships in `dist/`, so Node is **not** required to run it.

```bash
./start.sh                  # → http://127.0.0.1:8787
```

That is the whole thing: it creates the database on first run, starts the server **detached** so it survives the terminal closing, and waits until the API actually answers before saying it is up.

```bash
./start.sh --status         # is it running?
./stop.sh                   # stop it
```

Logs go to `data/server.log`, the process id to `data/server.pid`.

> If you (or an AI agent setting this up for you) run `python3 serve.py &` instead, the server dies with the shell that started it — it looks like it worked, then the page stops loading. Use `./start.sh`.

Open `http://127.0.0.1:8787` in your browser. You'll see a few demo accounts, a demo credit card and a starter set of budget categories. Delete them in the UI — Accounts, Debt and Budget each have an **Add** button and a trash icon on every card — and put your own in.

### Rebuilding the frontend (optional)

```bash
cd dashboard
npm install
npm run build              # outputs to ../dist
```

---

## Working with the AI agent

The whole point of this template is that you **don't** operate it by hand. Two setups:

**A — You already use Claude Code.** Point it at this folder. It reads `CLAUDE.md` and can immediately add transactions, import statements, and answer questions. Fastest path.

**B — You're new to AI tooling.** Follow [`SETUP.md`](SETUP.md) for the one-command installer. It sets up the agent for you, and the agent walks you through your accounts and your first import.

Standard actions (add transaction, import statement, add account) are meant to become **skills** — short, deterministic commands the agent runs in seconds instead of re-deriving the codebase each time. See `CLAUDE.md` → *Standard actions*.

---

## Importing bank statements

The normal way is to hand the file to your agent — attach the CSV in the conversation and say "import this". It runs the steps below for you.

By hand:

```bash
# a single file, from anywhere — no folder needed
python3 normalize.py --in ~/Downloads/statement.csv --out data/normalized.csv

# or drop one export into Statements/ and let it find it
python3 normalize.py                 # Statements/*.csv → data/normalized.csv

python3 import_csv.py --dry-run      # preview
python3 import_csv.py                # write to the DB
```

**Import one statement at a time.** Normalizing several CSVs in one run is refused
on purpose: each bank needs its own pass over the categorization rules, and a
batch import lands everything uncategorized while still looking like it worked.
`normalize.py` prints the payees that matched no rule — add them to
`rules/categorize.json`, re-run, and only then import. `import_csv.py` refuses to
commit when 30% or more of the incoming rows have no category.

Re-imports are idempotent (dedup by row id) and additive, so overlapping statements are safe. Your manual edits live in a separate `tx_overrides` table and **survive re-imports**. Clearing and re-importing one statement is scoped to that file: `python3 import_csv.py --replace --replace-source-file Revolut.csv`.

### Adding a new bank

Write `profiles/<yourbank>.json` describing the CSV's columns, date format, and decimal separator. Copy an existing profile (e.g. `profiles/revolut.json`) as a starting point. Categorization rules for all banks live in `rules/categorize.json`.

---

## What's in the box

| Path | Role |
|---|---|
| `serve.py` | HTTP API (`/api/*`) + static file serving. `Store` class = all DB access. |
| `start.sh` / `stop.sh` | Start the server detached (survives the shell) / stop it. |
| `init_db.py` | Creates schema, seeds reference data from `data/*.json`. `--reset` drops everything. |
| `normalize.py` | Profile-driven CSV → unified `normalized.csv`. |
| `import_csv.py` | `normalized.csv` → SQLite. Additive + deduplicating; `--dry-run`, scoped `--replace-source-file`. |
| `reconcile_balances.py` | Reconcile derived balances against an as-of statement figure. |
| `ledger.py` | The one definition of how a transaction moves money (transfer pairing, balances). |
| `profiles/*.json` | Per-bank CSV format definitions (Revolut, Wise). |
| `rules/categorize.json` | Merchant canonicalization + category mapping (starter set — edit freely). |
| `data/*.json` | Reference seed data (accounts, categories, budget, debts). |
| `dashboard/` | React + Vite + Tailwind frontend source. |
| `dist/` | Pre-built frontend served by `serve.py`. |
| `tests/` | `python3 -m unittest discover -s tests` — transfer pairing, planned-entry sweep, import safety. |

---

## License

Add your license here before distributing.
