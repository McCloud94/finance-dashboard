#!/bin/sh
# Create the DB on first boot (fresh data/ volume), then start the server.
set -e
if [ ! -f /app/data/data.db ]; then
  echo "→ first boot: initializing database"
  python3 init_db.py
fi
exec python3 serve.py
