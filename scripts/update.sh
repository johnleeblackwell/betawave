#!/usr/bin/env bash
set -e

echo "βWave updater"
echo "─────────────────────────────────────────"

# Back up the database before touching anything
if [ -f ./data/data.db ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  cp ./data/data.db "./data/data.db.bak-${STAMP}"
  echo "✓ database backed up → data/data.db.bak-${STAMP}"
fi

# Pull latest code
git pull origin main
echo "✓ code updated"

# Rebuild and restart (zero-downtime: compose handles the swap)
docker compose up -d --build
echo "✓ container rebuilt and restarted"

echo ""
echo "Done. Check logs with: docker compose logs -f bwave"
