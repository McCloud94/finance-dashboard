#!/usr/bin/env bash
#
# Finance Dashboard installer.
#   curl -fsSL https://raw.githubusercontent.com/McCloud94/finance-dashboard/main/install.sh | bash
#
# Sets up a private finance dashboard + an AI assistant that runs it for you.
#
# Installs on THIS computer by default — that is the path almost everyone wants,
# and it needs nothing but python3. The always-on server build is the same
# script run with --server, ON the server itself (see SETUP.md → Online). It is
# deliberately not offered as a menu choice here: choosing it from a laptop used
# to look like an option and then fail on the missing Docker daemon, because
# nothing in this script rents or reaches a server for you.
set -euo pipefail

REPO="https://github.com/McCloud94/finance-dashboard.git"
DIR="${INSTALL_DIR:-$HOME/finance-dashboard}"

MODE="local"
for arg in "$@"; do
  case "$arg" in
    --server|--vps) MODE="server" ;;
    --local)        MODE="local" ;;
  esac
done

# --- pretty helpers -------------------------------------------------------
B=$'\033[1m'; DIM=$'\033[2m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; R=$'\033[0m'
say()  { printf '\n%s%s%s\n' "$B" "$*" "$R"; }
note() { printf '%s%s%s\n' "$DIM" "$*" "$R"; }
ok()   { printf '%s✓%s %s\n' "$G" "$R" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$R" "$*"; }
ask()  { local p="$1" d="${2:-}" a; read -rp "$(printf '%s%s%s%s: ' "$C" "$p" "$R" "${d:+ [$d]}")" a </dev/tty; echo "${a:-$d}"; }

banner() {
cat <<'EOF'

  ┌──────────────────────────────────────┐
  │   Personal Finance Dashboard         │
  └──────────────────────────────────────┘
EOF
note "  Get organized and keep perfect clarity and control over your finances"
note "  — on about 15 minutes of work a month."
echo
note "  A private, intelligent money dashboard that lives on your computer."
note "  You tell an AI what you need — import a bank statement at the end of"
note "  the month, add a transaction, ask a question about your finances —"
note "  and it does the rest."
echo
note "  No spreadsheets or apps, no logins."
}

# --- 1. Get the code ------------------------------------------------------
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only -q && ok "Updated $DIR"
else
  git clone --depth 1 -q "$REPO" "$DIR" && ok "Downloaded to $DIR"
fi
cd "$DIR"
banner

# =========================================================================
# LOCAL — clone + an AI agent. No Docker.
# =========================================================================
if [ "$MODE" = "local" ]; then
  say "Setting it up on this computer"
  note "  Private and free. Your data is a single file in $DIR/data — it never"
  note "  leaves this machine. Three steps: database, assistant, first chat."

  command -v python3 >/dev/null || { echo "python3 is required (preinstalled on Mac). Install it, then re-run."; exit 1; }
  [ -f data/data.db ] || { python3 init_db.py >/dev/null && ok "Created your database"; }

  # Detect an existing agent.
  HAVE_CC=$(command -v claude >/dev/null && echo 1 || echo "")
  HAVE_HM=$(command -v hermes >/dev/null && echo 1 || echo "")
  LAUNCH=""

  say "The assistant"
  if [ -n "$HAVE_CC" ] || [ -n "$HAVE_HM" ]; then
    [ -n "$HAVE_HM" ] && { ok "Found Hermes"; LAUNCH="hermes"; }
    [ -n "$HAVE_CC" ] && { ok "Found Claude Code"; LAUNCH="${LAUNCH:-claude}"; }
    note "  It'll read this folder's instructions and act as your finance assistant."
  else
    echo "  You need one AI agent to talk to. Hermes is free, works great here,"
    echo "  and connects to Telegram so you can message it from your phone."
    note "  It asks you to pick a model and sign in on first launch — you'll need"
    note "  an account with whichever model provider it offers."
    if [ "$(ask 'Install Hermes now? y/n' y)" = "y" ]; then
      say "Installing Hermes"
      curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
      note "  (Windows users install with:  irm https://hermes-agent.nousresearch.com/install.ps1 | iex )"
      command -v hermes >/dev/null && LAUNCH="hermes" || LAUNCH="hermes"
      note "  Hermes will run its own quick setup (pick a model, connect Telegram) on first launch."
    else
      note "  No problem — install any agent later and point it at $DIR."
    fi
  fi

  # Give Hermes the finance skills (it loads AGENTS.md automatically either way).
  if [ -n "$HAVE_HM" ] || [ "$LAUNCH" = "hermes" ]; then
    mkdir -p "$HOME/.hermes/skills" && cp -r .claude/skills/finance-* "$HOME/.hermes/skills/" 2>/dev/null && ok "Installed finance skills for Hermes"
  fi

  say "You're set 🎉"
  if [ -n "$LAUNCH" ]; then
    echo "  Meet your assistant — run:"
    echo
    echo "      ${B}cd \"$DIR\" && $LAUNCH${R}"
    echo
    echo "  It greets you and walks you through setup: your accounts, importing a"
    echo "  bank statement, opening the dashboard. Just talk to it normally."
    note "  To import your first month, export a CSV from your bank and send it to"
    note "  the assistant in the chat — attaching the file is enough."
  else
    echo "  Start the dashboard:  ${B}cd \"$DIR\" && python3 serve.py${R}   → http://127.0.0.1:8787"
    echo "  Then point any AI agent at this folder to manage it in plain language."
  fi
  note "  Want it always-on and reachable from your phone instead? SETUP.md → Online."
  exit 0
fi

# =========================================================================
# SERVER — Docker box. Run this ON the server, not on your laptop.
# =========================================================================
say "Server install"
note "  This builds the always-on box: dashboard + HTTPS + optional Telegram agent."

if [ "$(uname -s)" = "Darwin" ]; then
  warn "This looks like a Mac, not a server."
  note "  --server is meant to be run ON a Linux server you have already rented"
  note "  and SSH'd into. It does not create or connect to one for you."
  note "  For this computer, re-run without --server. Full walkthrough: SETUP.md."
  exit 1
fi

if ! command -v docker >/dev/null; then
  echo "Docker not found. Install Docker on this server first, then re-run:"
  echo "    curl -fsSL https://get.docker.com | sh"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but its daemon isn't reachable."
  echo "Start it (e.g. 'sudo systemctl start docker'), then re-run."
  exit 1
fi
ok "Docker is running"

IP="$(curl -fsS4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
DEF_DOMAIN="$(echo "$IP" | tr '.' '-').sslip.io"

say "Public address"
note "  The dashboard needs a hostname so it can get an HTTPS certificate."
note "  sslip.io gives you one for free from this server's IP — nothing to buy,"
note "  no DNS to configure. Press Enter to accept it, or type your own domain"
note "  if you already point one at this server."
DOMAIN="$(ask 'Domain' "$DEF_DOMAIN")"

say "Login (protects your dashboard on the open internet)"
note "  Pick anything you like — you'll type these in the browser once."
BASIC_USER="$(ask 'Username' admin)"
PW="$(ask 'Password')"
BASIC_HASH="$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$PW")"

say "AI agent (Hermes)?"
note "  Adds Telegram + voice control: text/say 'add -30 food, revolut' from your phone."
note "  Needs an OpenRouter account (openrouter.ai) for the model, and a Telegram"
note "  account to message it from. Say no and the dashboard still works."
WANT_AGENT="$(ask 'Enable agent? y/n' n)"

OPENROUTER_API_KEY=""; PROFILE=""
if [ "$WANT_AGENT" = "y" ]; then
  PROFILE="agent"
  OPENROUTER_API_KEY="$(ask 'OpenRouter API key (openrouter.ai/keys)')"
  # Telegram is paired interactively (`hermes setup`) after the box is up, not here.
  if [ ! -d hermes/.git ]; then
    say "Fetching Hermes agent"
    git clone --depth 1 https://github.com/NousResearch/hermes-agent.git hermes
  fi
fi

say "Writing .env"
cat > .env <<EOF
DOMAIN=$DOMAIN
BASIC_USER=$BASIC_USER
BASIC_HASH=$BASIC_HASH
OPENROUTER_API_KEY=$OPENROUTER_API_KEY
EOF
chmod 600 .env

say "Starting the box"
note "  First build pulls a few images — a minute or two."
if [ -n "$PROFILE" ]; then
  docker compose --profile "$PROFILE" up -d --build
else
  docker compose up -d --build
fi

say "Live 🎉"
echo "  Dashboard:  https://$DOMAIN   (login: $BASIC_USER)"
note "  The HTTPS certificate is issued on the first visit — give it a few seconds."
if [ -n "$PROFILE" ]; then
  echo "  Agent:      pair Telegram once ->  docker compose exec hermes hermes setup"
  echo "              then message your bot: 'add -30 food, revolut'."
fi
echo "  Logs:       cd \"$DIR\" && docker compose logs -f"
