#!/bin/sh
set -e

mkdir -p /data
rm -f /root/.claude/knowledge-base/settings.json

INVITE=$(cat /shared/invite.txt)
echo "[peer-continuous] Joining with invite: $INVITE"

cd /root
node /app/dist/bin/cli.js team join "$INVITE" --no-github-auth --username e2e-peer

echo "[peer-continuous] Starting team server for ongoing sync..."
node /app/dist/bin/cli.js team server &
SERVER_PID=$!

# Give swarm enough time to connect to host and register pusher on host side (~3-4s)
sleep 5

echo "[peer-continuous] Signaling host that peer is connected..."
touch /shared/peer-joined.txt

echo "[peer-continuous] Waiting for host-edited.txt (max 30s)..."
i=0
while [ ! -f /shared/host-edited.txt ]; do
  sleep 1
  i=$((i+1))
  if [ $i -ge 30 ]; then
    echo "[peer-continuous] TIMEOUT: host never wrote host-edited.txt"
    kill "$SERVER_PID" 2>/dev/null || true
    exit 1
  fi
done

echo "[peer-continuous] Host updated doc. Waiting 2s for push-on-write to deliver..."
sleep 2

kill "$SERVER_PID" 2>/dev/null || true

echo "[peer-continuous] Verifying peer received the update..."
node /e2e/verify-peer-continuous.mjs
echo "[peer-continuous] E2E continuous sync PASSED"
