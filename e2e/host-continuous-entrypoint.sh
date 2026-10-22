#!/bin/sh
set -e

mkdir -p /data
rm -f /root/.claude/knowledge-base/settings.json

echo "[host-continuous] Seeding workspace..."
node /e2e/seed-host.mjs

echo "[host-continuous] Starting continuous sync server..."
node /e2e/host-continuous-server.mjs &
SERVER_PID=$!

echo "[host-continuous] Waiting for peer-joined.txt (max 45s)..."
i=0
while [ ! -f /shared/peer-joined.txt ]; do
  sleep 1
  i=$((i+1))
  if [ $i -ge 45 ]; then
    echo "[host-continuous] TIMEOUT: peer never signaled join"
    kill "$SERVER_PID" 2>/dev/null || true
    exit 1
  fi
done

echo "[host-continuous] Peer joined. Triggering doc update..."
touch /shared/trigger-push.txt

# Stay alive until compose stops this container (--exit-code-from=peer)
wait "$SERVER_PID" || true
