# Finance Dashboard

A local-first personal finance dashboard, **controlled by an AI agent**. You talk to it in plain language — "add a €40 grocery expense", "import my Revolut statement", "how much did I spend on food this month" — and the agent does it. No spreadsheets, no manual data entry.

- **Your data stays yours.** One SQLite file on your machine. No cloud account, no signup, no API keys.
- **Zero backend dependencies.** The server is Python standard library only.
- **Bank-agnostic import.** Adding support for a new bank = writing one small JSON profile, never touching code. Ships with profiles for Revolut, Wise, and Bybit.
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
# 1. Create the database (schema + demo seed data)
python3 init_db.py

# 2. Start the server
python3 serve.py            # → http://127.0.0.1:8787
```

Open `http://127.0.0.1:8787` in your browser. You'll see the dashboard populated with a few demo accounts. Delete them in the UI and add your own.

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

**B — You're new to AI tooling.** Follow `SETUP.md` (to be written) for the one-command installer that sets up the agent for you and walks you through your first import.

Standard actions (add transaction, import statement, add account) are meant to become **skills** — short, deterministic commands the agent runs in seconds instead of re-deriving the codebase each time. See `CLAUDE.md` → *Standard actions*.

---

## Importing bank statements

```bash
# Drop your bank's CSV export into Statements/, then:
python3 normalize.py                 # Statements/*.csv → data/normalized.csv
python3 import_csv.py --dry-run      # preview
python3 import_csv.py                # write to the DB
```

A single file works too, no folder needed: `python3 normalize.py --in ~/Downloads/statement.csv --out data/normalized.csv`.

Re-imports are idempotent (dedup by row id) and additive, so overlapping statements are safe. Your manual edits live in a separate `tx_overrides` table and **survive re-imports**. Clearing and re-importing one statement is scoped to that file: `python3 import_csv.py --replace --replace-source-file Revolut.csv`.

### Adding a new bank

Write `profiles/<yourbank>.json` describing the CSV's columns, date format, and decimal separator. Copy an existing profile (e.g. `profiles/revolut.json`) as a starting point. Categorization rules for all banks live in `rules/categorize.json`.

---

## Deployment

This is designed to run on **one box** where both the dashboard and the AI agent live together.

- **Recommended: a VPS (e.g. Hetzner).** Real shell + persistent disk means the agent (Hermes or headless Claude Code) lives next to the data, reachable via Telegram or a desktop app. Front with Caddy for HTTPS; use systemd to keep `serve.py` always-on.
- **Railway / container PaaS:** can host the *dashboard only*. Requires a **persistent Volume** mounted at `data/` (containers have ephemeral disks — otherwise your DB is wiped on every deploy). It does **not** give the AI agent a shell to live on, so the AI-control layer won't work there. Use only for a no-AI, dashboard-only setup.

---

## What's in the box

| Path | Role |
|---|---|
| `serve.py` | HTTP API (`/api/*`) + static file serving. `Store` class = all DB access. |
| `init_db.py` | Creates schema, seeds reference data from `data/*.json`. `--reset` drops everything. |
| `normalize.py` | Profile-driven CSV → unified `normalized.csv`. |
| `import_csv.py` | `normalized.csv` → SQLite. Additive + deduplicating; `--dry-run`, scoped `--replace-source-file`. |
| `reconcile_balances.py` | Reconcile derived balances against an as-of statement figure. |
| `ledger.py` | The one definition of how a transaction moves money (transfer pairing, balances). |
| `profiles/*.json` | Per-bank CSV format definitions (Revolut, Wise, Bybit). |
| `rules/categorize.json` | Merchant canonicalization + category mapping (starter set — edit freely). |
| `data/*.json` | Reference seed data (accounts, categories, budget, debts). |
| `dashboard/` | React + Vite + Tailwind frontend source. |
| `dist/` | Pre-built frontend served by `serve.py`. |
| `tests/` | `python3 -m unittest discover -s tests` — transfer pairing, planned-entry sweep, import safety. |

---

## License

Add your license here before distributing.
