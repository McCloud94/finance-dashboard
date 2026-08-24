# Setup

A private finance dashboard you run yourself. Add transactions, accounts and budgets in the app — or just *tell an AI agent* in plain language ("add -30 food, revolut") and it does it in seconds.

Two ways to run it: **Local** (on your computer) or **Online** (on a small server, reachable from your phone). Start local; move online later if you want.

---

## Fastest start (one command)

On Mac or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/McCloud94/finance-dashboard/main/install.sh | bash
```

It downloads the project and asks where to run it — **1) on this computer** or **2) on a server**. Both paths are described below. Prefer to do everything by hand? Read on.

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

### What you need first

1. **A Linux server.** Any cheap VPS — Hetzner, DigitalOcean, Vultr. Budget about **€10/month** for one comfortable enough to run the agent too. Choose **Ubuntu** when it asks for an image. When it's created, the provider shows you an **IP address** and either a root password or your SSH key.
2. **A terminal on that server.** From your own Mac or Linux machine:
   ```bash
   ssh root@YOUR-SERVER-IP
   ```
   Everything from here happens **on the server**. That's the whole meaning of option 2 — the installer doesn't rent a server or log into one for you.

You do **not** need to install Docker, git, or anything else first. The installer does that part.

### Then run

On the server:

```bash
curl -fsSL https://raw.githubusercontent.com/McCloud94/finance-dashboard/main/install.sh | bash
# choose 2) On a server
```

It then walks through five steps, in this order:

1. **Docker** — installed and started for you if the server hasn't got it (it usually hasn't). This is what runs the dashboard, the HTTPS proxy and the agent.
2. **Your web address** — see below.
3. **A login** — see below.
4. **The AI agent** — optional, see below.
5. **Starting everything** — builds and launches the containers.

It asks for:
- **Domain** — the hostname your dashboard answers on. It needs one because browsers won't issue an HTTPS certificate to a bare IP address. Press Enter to take the **sslip.io** default: `sslip.io` is a free public DNS service that resolves any address of the form `146-70-114-182.sslip.io` straight back to `146.70.114.182`. Nothing to buy, no DNS records to create, and Caddy gets a real certificate for it. Type your own domain instead only if you already point one at this server.
- **Login** — a username and password you choose, so strangers can't read your finances. You type them into the browser once and your phone remembers them. Only the encrypted form is stored on the server.
- **Agent** — yes/no. Yes needs two accounts: [OpenRouter](https://openrouter.ai/keys) (pay-as-you-go, provides the AI model — the key starts `sk-or-`) and Telegram (free, how you message it). Telegram is paired in one interactive step *after* launch — see below. Say no and you still get the full dashboard; you can enable the agent later.

Then it starts everything and prints your `https://…` URL. The certificate is issued on the first visit, so if the browser complains on that very first load, wait ten seconds and reload.

If you enabled the agent, one step is left — pair Telegram:

```bash
cd ~/finance-dashboard && docker compose exec hermes hermes setup
```

It walks you through creating a bot and linking it. After that, message the bot from your phone: *"add -25 dinner, revolut"*.

**If the URL doesn't load at all**, your provider's own firewall is probably blocking ports 80 and 443 — that one lives in their web panel, not on the server. On Hetzner: Cloud Console → your server → Firewalls.

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
