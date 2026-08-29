#!/usr/bin/env bash
#
# Finance Dashboard installer.
#   curl -fsSL https://raw.githubusercontent.com/McCloud94/finance-dashboard/main/install.sh | bash
#
# Sets up a private finance dashboard + an AI assistant that runs it for you.
#
# Two targets, asked below: this computer (python3, nothing else) or a server
# (Docker: dashboard + HTTPS + optional Telegram agent). The server path is
# meant to be run ON the server, and installs what a fresh box is missing —
# git and Docker included — rather than telling you to go and get them.
set -euo pipefail

REPO="https://github.com/McCloud94/finance-dashboard.git"
DIR="${INSTALL_DIR:-$HOME/finance-dashboard}"

# --force-mode skips the question (used by re-runs and by SETUP.md's copy-paste).
MODE=""
for arg in "$@"; do
  case "$arg" in
    --server|--vps) MODE="2" ;;
    --local)        MODE="1" ;;
  esac
done

# --- pretty helpers -------------------------------------------------------
B=$'\033[1m'; DIM=$'\033[2m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; R=$'\033[0m'
say()  { printf '\n%s%s%s\n' "$B" "$*" "$R"; }
note() { printf '%s%s%s\n' "$DIM" "$*" "$R"; }
ok()   { printf '%s✓%s %s\n' "$G" "$R" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$R" "$*"; }
ask()  { local p="$1" d="${2:-}" a; read -rp "$(printf '%s%s%s%s: ' "$C" "$p" "$R" "${d:+ [$d]}")" a </dev/tty; echo "${a:-$d}"; }

SUDO=""
[ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null && SUDO="sudo"

# Install OS packages. Only ever called on Linux (the server path) — a Mac has
# git via the developer tools and never needs Docker here.
pkg_install() {
  if command -v apt-get >/dev/null; then
    $SUDO apt-get update -qq
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
  elif command -v dnf >/dev/null; then
    $SUDO dnf install -y -q "$@"
  elif command -v yum >/dev/null; then
    $SUDO yum install -y -q "$@"
  else
    return 1
  fi
}

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

banner

# --- 1. Get the code ------------------------------------------------------
# git first: a fresh Linux server usually hasn't got it, and without it the
# clone below fails on the user's very first command.
if ! command -v git >/dev/null; then
  if [ "$(uname -s)" = "Linux" ]; then
    say "Installing git"
    pkg_install git || { echo "Couldn't install git automatically. Install it, then re-run."; exit 1; }
    ok "git installed"
  else
    echo "git is required. On a Mac, run 'xcode-select --install', then re-run."
    exit 1
  fi
fi

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only -q && ok "Updated $DIR"
else
  git clone --depth 1 -q "$REPO" "$DIR" && ok "Downloaded to $DIR"
fi
cd "$DIR"

# --- 2. Pick a target -----------------------------------------------------
if [ -z "$MODE" ]; then
  say "Where do you want to run it?"
  echo
  echo "  ${B}1) On this computer${R}"
  echo "     Installs the dashboard in one folder on your computer."
  echo "     ${G}+${R} Easy, and free."
  echo "     ${Y}−${R} You can't view the dashboard from your phone, and you can't use"
  echo "       it while the computer is off."
  echo
  echo "  ${B}2) On a server${R}"
  echo "     ${B}Only pick this if you are already running this setup from a server.${R}"
  echo "     ${G}+${R} Dashboard and AI agent reachable from anywhere, 24/7. You're out"
  echo "       with friends for dinner — you send your finance agent a voice"
  echo "       message, \"add expense dinner, 25 euro, category food, account"
  echo "       Revolut\", and it's filed before dessert."
  echo "     ${Y}−${R} Costs money (about €10/month for the server), and takes longer"
  echo "       to set up."
  echo "     ${DIM}Walks you through: installing Docker, a free public web address"
  echo "     (sslip.io), an HTTPS certificate, a login, and the Hermes agent on"
  echo "     Telegram. About 5 minutes, mostly waiting.${R}"
  echo
  MODE="$(ask 'Choose 1 or 2' 1)"
fi

# Choosing "server" on a laptop is the one wrong turn this menu allows, and it
# used to fail late — four questions in, on the missing Docker daemon.
if [ "$MODE" = "2" ] && [ "$(uname -s)" = "Darwin" ]; then
  echo
  warn "This is a Mac, not a server."
  note "  Option 2 has to be run ON the server itself — it doesn't rent one or"
  note "  connect to one for you. To do that: rent a Linux server, 'ssh root@ITS-IP',"
  note "  and run this same command there. SETUP.md walks through it."
  echo
  if [ "$(ask 'Install on this computer instead? y/n' y)" = "y" ]; then
    MODE="1"
  else
    exit 1
  fi
fi

# =========================================================================
# LOCAL — clone + an AI agent. No Docker.
# =========================================================================
if [ "$MODE" = "1" ]; then
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
    echo "  Start the dashboard:  ${B}cd \"$DIR\" && ./start.sh${R}   → http://127.0.0.1:8787"
    note "  It keeps running after you close the terminal. Stop it with ./stop.sh."
    echo "  Then point any AI agent at this folder to manage it in plain language."
  fi
  note "  Want it always-on and reachable from your phone instead? SETUP.md → Online."
  exit 0
fi

# =========================================================================
# SERVER — Docker box. Assumes it is running ON the server.
# =========================================================================
say "Setting it up on this server"
note "  Five steps: Docker, a web address, an HTTPS certificate, a login, and"
note "  (optionally) the AI agent on Telegram. Everything runs in containers, so"
note "  nothing is scattered around the machine and it all starts again on reboot."

# --- Docker ---------------------------------------------------------------
# Required, not a preference: the box is three containers (the dashboard, Caddy
# for HTTPS + the login gate, and Hermes). A fresh server has none of it.
say "Step 1/5 — Docker"
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  ok "Docker is already installed and running"
else
  if ! command -v docker >/dev/null; then
    note "  Docker runs the dashboard, the HTTPS proxy and the agent as separate"
    note "  containers. Installing it now from get.docker.com — takes a minute."
    curl -fsSL https://get.docker.com | $SUDO sh
    ok "Docker installed"
  fi
  if ! docker info >/dev/null 2>&1; then
    $SUDO systemctl enable --now docker 2>/dev/null || $SUDO service docker start 2>/dev/null || true
  fi
  docker info >/dev/null 2>&1 || {
    echo "Docker is installed but won't start. Check 'systemctl status docker', then re-run."
    exit 1
  }
  ok "Docker is running"
fi

docker compose version >/dev/null 2>&1 || {
  echo "This Docker has no 'compose' plugin. Install Docker from get.docker.com (it bundles it), then re-run."
  exit 1
}

# --- Public address -------------------------------------------------------
say "Step 2/5 — Your web address"
IP="$(curl -fsS4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
DEF_DOMAIN="$(echo "$IP" | tr '.' '-').sslip.io"
note "  A dashboard on the internet needs a hostname before it can get an HTTPS"
note "  certificate — browsers won't issue one for a bare IP address."
note "  sslip.io solves that for free: the address below simply resolves back to"
note "  this server's IP ($IP). Nothing to buy, no DNS to configure."
note "  Press Enter to take it, or type your own domain if you already point one"
note "  at this server."
DOMAIN="$(ask 'Domain' "$DEF_DOMAIN")"

# --- Login ----------------------------------------------------------------
say "Step 3/5 — A login"
note "  Your dashboard will be reachable from the open internet, so it needs a"
note "  password gate. Pick anything you like — you'll type it in the browser"
note "  once and your phone will remember it. Only the encrypted form is stored."
BASIC_USER="$(ask 'Username' admin)"
PW=""
while [ -z "$PW" ]; do
  PW="$(ask 'Password')"
  [ -z "$PW" ] && warn "  A password is required — the dashboard would be public without one."
done
BASIC_HASH="$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$PW")"
ok "Login set for '$BASIC_USER'"

# --- Agent ----------------------------------------------------------------
say "Step 4/5 — The AI agent (optional)"
note "  This is the part that makes it worth having on a server: Hermes on"
note "  Telegram. Text or send a voice message — 'add expense dinner, 25 euro,"
note "  category food, account Revolut' — and it files it, wherever you are."
note "  You'll need two accounts: OpenRouter (openrouter.ai, pay-as-you-go, for"
note "  the AI model) and Telegram (free, to message it from)."
note "  Say no and you still get the full dashboard; you can add this later."
WANT_AGENT="$(ask 'Enable the agent? y/n' y)"

OPENROUTER_API_KEY=""; PROFILE=""
if [ "$WANT_AGENT" = "y" ]; then
  PROFILE="agent"
  note "  Get a key at https://openrouter.ai/keys (sign up, add a few euro, create"
  note "  a key). It starts with 'sk-or-'."
  OPENROUTER_API_KEY="$(ask 'OpenRouter API key')"
  # Telegram is paired interactively (`hermes setup`) after the box is up, not here.
  if [ ! -d hermes/.git ]; then
    say "Fetching the Hermes agent"
    git clone --depth 1 -q https://github.com/NousResearch/hermes-agent.git hermes && ok "Hermes downloaded"
  fi
fi

say "Writing .env"
# Compose interpolates the values inside .env before substituting them into the
# compose file, so a literal $ has to be written as $$ or it is eaten. bcrypt
# hashes are all $-delimited ($2a$14$...), so without this the login gate gets a
# truncated hash and rejects the password you just chose — on every install.
esc() { printf '%s' "$1" | sed 's/\$/$$/g'; }
cat > .env <<EOF
DOMAIN=$(esc "$DOMAIN")
BASIC_USER=$(esc "$BASIC_USER")
BASIC_HASH=$(esc "$BASIC_HASH")
OPENROUTER_API_KEY=$(esc "$OPENROUTER_API_KEY")
EOF
chmod 600 .env
ok "Settings saved (.env, readable only by you)"

# --- Firewall -------------------------------------------------------------
# Only touches a firewall that is actually switched on. A cloud-provider
# firewall (Hetzner's, AWS security groups) is configured in their web panel and
# can't be seen from in here — hence the closing note rather than a silent pass.
if command -v ufw >/dev/null && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
  say "Opening the web ports"
  $SUDO ufw allow 80/tcp  >/dev/null 2>&1 || true
  $SUDO ufw allow 443/tcp >/dev/null 2>&1 || true
  ok "Ports 80 and 443 opened in the firewall"
fi

# --- Launch ---------------------------------------------------------------
say "Step 5/5 — Starting everything"
note "  First run downloads and builds the images — a couple of minutes."
if [ -n "$PROFILE" ]; then
  docker compose --profile "$PROFILE" up -d --build
else
  docker compose up -d --build
fi

say "Live 🎉"
echo "  Dashboard:  ${B}https://$DOMAIN${R}"
echo "  Login:      $BASIC_USER  (the password you just chose)"
note "  The HTTPS certificate is issued on your first visit — if the browser"
note "  warns on the very first load, give it ten seconds and reload."
if [ -n "$PROFILE" ]; then
  echo
  echo "  ${B}One step left${R} — connect Telegram to your agent:"
  echo
  echo "      ${B}cd \"$DIR\" && docker compose exec hermes hermes setup${R}"
  echo
  echo "  It walks you through creating a bot and pairing it. After that, message"
  echo "  the bot from your phone: 'add -25 dinner, revolut'."
fi
echo
note "  Logs:    cd \"$DIR\" && docker compose logs -f"
note "  Stop:    cd \"$DIR\" && docker compose down"
note "  Update:  cd \"$DIR\" && git pull && docker compose up -d --build"
echo
note "  If the address doesn't load at all, your provider's own firewall may be"
note "  blocking ports 80/443 — open them in their web panel (for Hetzner:"
note "  Cloud Console → your server → Firewalls)."
