#!/usr/bin/env bash
#
# Finance Dashboard installer.
#   curl -fsSL https://raw.githubusercontent.com/McCloud94/finance-dashboard/main/install.sh | bash
#
# Clones the repo, then walks you through a Local or a VPS (online) setup.
set -euo pipefail

REPO="https://github.com/McCloud94/finance-dashboard.git"
DIR="${INSTALL_DIR:-$HOME/finance-dashboard}"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ask()  { local p="$1" d="${2:-}"; local a; read -rp "$p${d:+ [$d]}: " a </dev/tty; echo "${a:-$d}"; }

# --- 1. Get the code ------------------------------------------------------
if [ -d "$DIR/.git" ]; then
  say "Updating existing install at $DIR"
  git -C "$DIR" pull --ff-only
else
  say "Cloning into $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"

# --- 2. Pick a mode -------------------------------------------------------
say "How do you want to run this?"
echo "  1) Local  — on this computer, private, no login. Fastest."
echo "  2) Online — on a VPS: always-on, phone access, optional AI agent."
MODE="$(ask 'Choose 1 or 2' 1)"

# =========================================================================
# LOCAL
# =========================================================================
if [ "$MODE" = "1" ]; then
  command -v python3 >/dev/null || { echo "python3 not found — install it first."; exit 1; }
  [ -f data/data.db ] || { say "Creating database"; python3 init_db.py; }
  say "Done. Start the dashboard any time with:"
  echo "    cd $DIR && python3 serve.py"
  echo "  then open http://127.0.0.1:8787"
  echo
  echo "  Using an AI agent (Claude Code / Hermes / ChatGPT)? Point it at $DIR"
  echo "  — it auto-reads CLAUDE.md and the skills in .claude/skills/."
  exit 0
fi

# =========================================================================
# VPS / ONLINE
# =========================================================================
command -v docker >/dev/null || { echo "Docker not found. Install Docker first, then re-run."; exit 1; }

IP="$(curl -fsS4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
DEF_DOMAIN="$(echo "$IP" | tr '.' '-').sslip.io"

say "Public address"
echo "  sslip.io turns your IP into a hostname with zero DNS setup."
DOMAIN="$(ask 'Domain' "$DEF_DOMAIN")"

say "Login (protects your dashboard on the open internet)"
BASIC_USER="$(ask 'Username' admin)"
PW="$(ask 'Password')"
BASIC_HASH="$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$PW")"

say "AI agent (Hermes)?"
echo "  Adds Telegram + voice control: text/say 'add -30 food, revolut' from your phone."
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

# --- Write .env -----------------------------------------------------------
say "Writing .env"
cat > .env <<EOF
DOMAIN=$DOMAIN
BASIC_USER=$BASIC_USER
BASIC_HASH=$BASIC_HASH
OPENROUTER_API_KEY=$OPENROUTER_API_KEY
EOF
chmod 600 .env

# --- Launch ---------------------------------------------------------------
say "Starting the box"
if [ -n "$PROFILE" ]; then
  docker compose --profile "$PROFILE" up -d --build
else
  docker compose up -d --build
fi

say "Live 🎉"
echo "  Dashboard:  https://$DOMAIN   (login: $BASIC_USER)"
if [ -n "$PROFILE" ]; then
  echo "  Agent:      pair Telegram once ->  docker compose exec hermes hermes setup"
  echo "              then message your bot: 'add -30 food, revolut'."
fi
echo "  Logs:       cd $DIR && docker compose logs -f"
