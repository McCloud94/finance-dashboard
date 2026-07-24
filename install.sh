#!/usr/bin/env bash
#
# Finance Dashboard installer.
#   curl -fsSL https://raw.githubusercontent.com/McCloud94/finance-dashboard/main/install.sh | bash
#
# Sets up a private finance dashboard + an AI assistant that runs it for you.
set -euo pipefail

REPO="https://github.com/McCloud94/finance-dashboard.git"
DIR="${INSTALL_DIR:-$HOME/finance-dashboard}"

# --- pretty helpers -------------------------------------------------------
B=$'\033[1m'; DIM=$'\033[2m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; R=$'\033[0m'
say()  { printf '\n%s%s%s\n' "$B" "$*" "$R"; }
note() { printf '%s%s%s\n' "$DIM" "$*" "$R"; }
ok()   { printf '%s✓%s %s\n' "$G" "$R" "$*"; }
ask()  { local p="$1" d="${2:-}" a; read -rp "$(printf '%s%s%s%s: ' "$C" "$p" "$R" "${d:+ [$d]}")" a </dev/tty; echo "${a:-$d}"; }
open_url() { command -v open >/dev/null && open "$1" 2>/dev/null || (command -v xdg-open >/dev/null && xdg-open "$1" 2>/dev/null) || true; }

banner() {
cat <<'EOF'

  ┌─────────────────────────────────────────┐
  │   💸  Personal Finance Dashboard          │
  └─────────────────────────────────────────┘
EOF
note "  A private money dashboard that lives on your computer. You tell an AI"
note "  assistant what you spent — by voice, text, or Telegram — and it files it."
note "  No spreadsheets, no logins, no data leaving your machine."
}

# --- 1. Get the code ------------------------------------------------------
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only -q && ok "Updated $DIR"
else
  git clone --depth 1 -q "$REPO" "$DIR" && ok "Downloaded to $DIR"
fi
cd "$DIR"
banner

# --- 2. Pick a mode -------------------------------------------------------
say "Where do you want to run it?"
echo "  ${B}1)${R} On this computer  ${DIM}— private, free, no login. Best for most people.${R}"
echo "  ${B}2)${R} On a server (VPS) ${DIM}— always-on, phone access. Needs Docker + a server.${R}"
MODE="$(ask 'Choose 1 or 2' 1)"

# =========================================================================
# LOCAL — clone + an AI agent. No Docker.
# =========================================================================
if [ "$MODE" = "1" ]; then
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
    echo "  It greets you and walks you through setup (accounts, importing a"
    echo "  bank statement, opening the dashboard). Just talk to it normally."
  else
    echo "  Start the dashboard:  ${B}cd \"$DIR\" && python3 serve.py${R}   → http://127.0.0.1:8787"
    echo "  Then point any AI agent at this folder to manage it in plain language."
  fi
  exit 0
fi

# =========================================================================
# VPS / ONLINE — Docker box.
# =========================================================================
command -v docker >/dev/null || { echo "Docker not found. Install Docker first, then re-run."; exit 1; }

IP="$(curl -fsS4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
DEF_DOMAIN="$(echo "$IP" | tr '.' '-').sslip.io"

say "Public address"
note "  sslip.io turns your IP into a hostname with zero DNS setup."
DOMAIN="$(ask 'Domain' "$DEF_DOMAIN")"

say "Login (protects your dashboard on the open internet)"
BASIC_USER="$(ask 'Username' admin)"
PW="$(ask 'Password')"
BASIC_HASH="$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$PW")"

say "AI agent (Hermes)?"
note "  Adds Telegram + voice control: text/say 'add -30 food, revolut' from your phone."
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
echo "  Logs:       cd \"$DIR\" && docker compose logs -f"
