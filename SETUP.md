# Setup

A private finance dashboard you run yourself. Add transactions, accounts and budgets in the app — or just *tell an AI agent* in plain language ("add -30 food, revolut") and it does it in seconds.

Two ways to run it: **Local** (on your computer) or **Online** (on a small server, reachable from your phone). Start local; move online later if you want.

---

## Fastest start (one command)

On Mac or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/McCloud94/finance-dashboard/main/install.sh | bash
```

It clones the project onto this computer, creates your database, and sets up an AI assistant to run it. Prefer to do it by hand? Read on.

(Want it always-on and reachable from your phone? That is the **Online** section below — it is a separate install you run on a server, not an option in this one.)

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
- **finance-import** — send it your bank's CSV export (attaching the file in the chat is enough), it normalizes + imports
- **finance-analysis** — "how am I doing this month", "where can I cut costs" → structured review

---

## Online — on a VPS (recommended for phone use)

Always-on, reachable from your phone, and can run the **Hermes agent** so you control everything over Telegram. Ships with the agent by default.

**Before you start, you need three things:**

1. **A Linux server.** Any cheap VPS works — Hetzner, DigitalOcean, Vultr — from about €4/month. Pick Ubuntu when it asks for an image. The provider emails you an IP address and a way to log in.
2. **A terminal session on it.** From your Mac or Linux machine: `ssh root@YOUR-SERVER-IP`. Everything below happens *on the server*, not on your own computer.
3. **Docker, on the server.** If it isn't there yet: `curl -fsSL https://get.docker.com | sh`.

Then, still on the server:

```bash
curl -fsSL https://raw.githubusercontent.com/McCloud94/finance-dashboard/main/install.sh | bash -s -- --server
```

The `--server` flag is what selects this build. Without it the installer sets up the local version instead, which is the right choice on your own computer.

It asks for:
- **Domain** — the hostname your dashboard answers on; it needs one to get an HTTPS certificate. Press Enter to accept the `sslip.io` default, which builds a working hostname out of your server's IP address for free — nothing to buy, no DNS to configure. Type your own domain instead only if you already point one at this server.
- **Login** — a username and password of your choosing, to keep strangers out of your dashboard. You'll type them in the browser once.
- **Agent** — yes/no. Yes needs an [OpenRouter account](https://openrouter.ai/keys) for the model and a Telegram account to message it from. (Telegram is paired in one interactive step *after* launch — see below.) No still gives you the full dashboard.

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
