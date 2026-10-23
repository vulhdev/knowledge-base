#!/bin/sh
set -e

mkdir -p /data

# settings.json was created during Docker build (CRSQLite pre-download side effect).
# Delete it so the DB_PATH env var is used for db_path on first openDb() call.
rm -f /root/.claude/knowledge-base/settings.json

echo "[host] Seeding workspace and generating invite..."
node /e2e/seed-host.mjs

echo "[host] Starting team server..."
exec node /app/dist/bin/cli.js team server
