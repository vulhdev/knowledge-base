#!/bin/sh
set -e

mkdir -p /data
rm -f /root/.claude/knowledge-base/settings.json

echo "[host-bidirectional] Seeding workspace..."
node /e2e/seed-host.mjs

echo "[host-bidirectional] Starting team server..."
node /app/dist/bin/cli.js team server &
SERVER_PID=$!

echo "[host-bidirectional] Waiting for peer-wrote.txt signal (max 45s)..."
i=0
while [ ! -f /shared/peer-wrote.txt ]; do
  sleep 1
  i=$((i+1))
  if [ $i -ge 45 ]; then
    echo "[host-bidirectional] TIMEOUT: peer-wrote.txt never appeared"
    kill "$SERVER_PID" 2>/dev/null || true
    exit 1
  fi
done

echo "[host-bidirectional] Signal received. Waiting 2s for sync to settle..."
sleep 2

kill "$SERVER_PID" 2>/dev/null || true

echo "[host-bidirectional] Verifying host received peer's doc..."
node /e2e/verify-host-bidirectional.mjs
echo "[host-bidirectional] E2E bidirectional PASSED"
