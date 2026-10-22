#!/bin/sh
set -e

mkdir -p /data

echo "[host] Seeding workspace and generating invite..."
node /e2e/seed-host.mjs

echo "[host] Starting team server..."
exec node /app/dist/bin/cli.js team server
