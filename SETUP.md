# Setup

A private finance dashboard you run yourself. Add transactions, accounts and budgets in the app — or just *tell an AI agent* in plain language ("add -30 food, revolut") and it does it in seconds.

Two ways to run it: **Local** (on your computer) or **Online** (on a small server, reachable from your phone). Start local; move online later if you want.

---

## Fastest start (one command)

On Mac or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/McCloud94/finance-dashboard/main/install.sh | bash
```

It clones the project and asks Local or Online, then does the rest. Prefer to do it by hand? Read on.

---

## Local — on your computer

Private, no login, nothing exposed to the internet. Needs `python3` (preinstalled on Mac).

```bash
git clone https://github.com/McCloud94/finance-dashboard.git
cd finance-dashboard
python3 init_db.py      # first time only
python3 serve.py        # open http://127.0.0.1:8787
```

The **selling point is the agent**: after a dinner or a grocery run, you say what you spent and it files it — no clicking through forms. Pick your path:

| Path | For you if… | What to do |
|------|-------------|-----------|
| **A. App only** | You already use Claude Code, Hermes, or ChatGPT desktop | Point your agent at this folder. It auto-reads `CLAUDE.md` + `.claude/skills/` and can add/edit transactions, import statements, and run a monthly review. Nothing else to install. |
| **B. App + Claude Code** | No agent yet, want the best coding-grade one | Install Claude Code (`npm i -g @anthropic-ai/claude-code`), run `claude` inside this folder, then talk to it. |
| **C. App + Hermes** | Want Telegram / voice control locally | Install Hermes (`curl -fsSL https://hermes-agent.nousresearch.com/install.sh \| bash`), run `hermes setup` (pairs Telegram). Then give it the finance skills: `cp -r .claude/skills/finance-* ~/.hermes/skills/`, and point its working folder at this project. |

What the agent can do out of the box (see `.claude/skills/`):
- **finance-ops** — "add -30 food, revolut", "log 2000 salary", "set food budget 400"
- **finance-import** — drop a bank CSV in `Statements/`, it normalizes + imports
- **finance-analysis** — "how am I doing this month", "where can I cut costs" → structured review

---

## Online — on a VPS (recommended for phone use)

Always-on, reachable from your phone, and can run the **Hermes agent** so you control everything over Telegram. Ships with the agent by default.

You need a cheap Linux server (e.g. Hetzner, ~€4/mo) with Docker installed. Then on the server:

```bash
curl -fsSL https://raw.githubusercontent.com/McCloud94/finance-dashboard/main/install.sh | bash
# choose 2) Online
```

It asks for:
- **Domain** — press Enter to accept the `sslip.io` default (turns your server IP into a real HTTPS hostname, zero DNS setup).
- **Login** — a username + password to protect the dashboard.
- **Agent** — yes/no. Yes → paste an [OpenRouter key](https://openrouter.ai/keys). (Telegram is paired in one interactive step *after* launch — see below.)

Then it starts everything and prints your `https://…` URL. If you enabled the agent, pair Telegram once:

```bash
docker compose exec hermes hermes setup     # follow the Telegram step
```

Done.

### What's running (the "box")

Docker Compose stack — three small containers:

- **dashboard** — the app + your data (in a persistent volume).
- **caddy** — automatic HTTPS + the login gate.
- **hermes** — the AI agent (only if you enabled it), on Telegram.

Manage it from the install folder:

```bash
docker compose logs -f          # watch logs
docker compose down             # stop
docker compose up -d            # start again
docker compose pull && docker compose up -d --build   # update
```

### Want a private URL instead of a login page?

Skip the public address entirely: install [Tailscale](https://tailscale.com) on the server and your phone, and reach the dashboard over your private network at a clean name — no password page, no public exposure. Trade-off: everyone who needs access installs the Tailscale app and signs in once.

---

## Your data

- Lives in `data/` (SQLite DB + config). On a VPS it's a Docker named volume that survives updates.
- Never leaves your machine/server. `.env` (secrets) and your statements are git-ignored.
- Back it up by copying `data/` somewhere safe.
