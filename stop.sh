#!/usr/bin/env bash
# Stop the dashboard started by ./start.sh.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$DIR/data/server.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "Not running (no data/server.pid)."
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  # SIGTERM is normally enough; escalate only if it is still there after 3s
  for _ in $(seq 1 10); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.3
  done
  kill -9 "$PID" 2>/dev/null || true
  echo "Stopped (pid $PID)."
else
  echo "Stale pid file (process $PID is gone)."
fi
rm -f "$PID_FILE"
