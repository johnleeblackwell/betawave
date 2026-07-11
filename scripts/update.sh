#!/usr/bin/env bash
set -e

echo "βWave updater"
echo "─────────────────────────────────────────"

# Docker path keeps the DB at ./data/data.db (DATABASE_PATH=/app/data/data.db
# inside the container). Running via plain `npm start` with no DATABASE_PATH
# set defaults to ./data.db in the project root instead — back up whichever
# one actually exists.
DB_FILE=""
if [ -f ./data/data.db ]; then
  DB_FILE=./data/data.db
elif [ -f ./data.db ]; then
  DB_FILE=./data.db
fi

if [ -n "$DB_FILE" ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  cp "$DB_FILE" "${DB_FILE}.bak-${STAMP}"
  echo "✓ database backed up → ${DB_FILE}.bak-${STAMP}"
fi

# Pull latest code
git pull origin main
echo "✓ code updated"

# Rebuild and restart
if [ -f docker-compose.yml ] && docker compose ps --status running 2>/dev/null | grep -q bwave; then
  docker compose up -d --build
  echo "✓ container rebuilt and restarted"
  echo ""
  echo "Done. Check logs with: docker compose logs -f bwave"
else
  npm install
  echo "✓ dependencies updated — restart the app: npm start"
fi
