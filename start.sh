#!/usr/bin/env bash
#
# Start the dashboard so it KEEPS RUNNING after the shell that started it exits.
#
# This exists because the obvious thing does not work. `python3 serve.py &` from
# an agent's tool call, a setup script, or an SSH command is a child of that
# shell: the health check passes, the agent reports success, and the server dies
# the moment the session closes. `nohup` + a detached process group + a PID file
# is what makes "it started" and "it is still up tomorrow" the same statement.
#
# Usage:  ./start.sh          start (or report it is already up)
#         ./start.sh --status just report
# Stop:   ./stop.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PORT="${DASH_PORT:-8787}"
HOST="${DASH_HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}"
PID_FILE="$DIR/data/server.pid"
LOG_FILE="$DIR/data/server.log"

PY="$(command -v python3 || true)"
[ -n "$PY" ] || { echo "python3 not found. Install Python 3, then re-run ./start.sh"; exit 1; }

mkdir -p "$DIR/data"

running() { curl -fsS -m 2 "$URL/api/data" >/dev/null 2>&1; }

if [ "${1:-}" = "--status" ]; then
  if running; then echo "up   → $URL"; exit 0; else echo "down"; exit 1; fi
fi

if running; then
  echo "Already running → $URL"
  exit 0
fi

# A PID file left by a crashed run would otherwise make stop.sh kill whatever
# process inherited that number.
if [ -f "$PID_FILE" ] && ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  rm -f "$PID_FILE"
fi

[ -f "$DIR/data/data.db" ] || "$PY" "$DIR/init_db.py"

# setsid where it exists (Linux) puts the server in its own process group so a
# Ctrl-C or a closing SSH session cannot signal it. macOS has no setsid; nohup
# plus the background job is enough there.
if command -v setsid >/dev/null 2>&1; then
  DASH_HOST="$HOST" DASH_PORT="$PORT" setsid nohup "$PY" "$DIR/serve.py" >>"$LOG_FILE" 2>&1 &
else
  DASH_HOST="$HOST" DASH_PORT="$PORT" nohup "$PY" "$DIR/serve.py" >>"$LOG_FILE" 2>&1 &
fi
echo $! > "$PID_FILE"

# Do not report success until the API actually answers — a port that is bound is
# not the same as a server that serves, and "it started briefly" is the exact
# failure this script exists to stop reporting.
for _ in $(seq 1 30); do
  if running; then
    echo "Dashboard running → $URL"
    echo "  pid:  $(cat "$PID_FILE")   log: data/server.log"
    echo "  stop: ./stop.sh"
    exit 0
  fi
  sleep 0.3
done

echo "Server did not come up within 9s. Last log lines:"
tail -n 20 "$LOG_FILE" || true
exit 1
