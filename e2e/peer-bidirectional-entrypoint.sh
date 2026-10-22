#!/bin/sh
set -e

mkdir -p /data
rm -f /root/.claude/knowledge-base/settings.json

INVITE=$(cat /shared/invite.txt)
echo "[peer-bidirectional] Joining with invite: $INVITE"

cd /root
node /app/dist/bin/cli.js team join "$INVITE" --no-github-auth --username e2e-peer

echo "[peer-bidirectional] Writing doc to peer DB..."
node /e2e/write-peer-doc.mjs

echo "[peer-bidirectional] Starting team server to push doc to host via initial sync..."
node /app/dist/bin/cli.js team server &
SERVER_PID=$!

# Give swarm enough time to connect + complete initial sync handshake (~3-4s on Docker bridge)
sleep 5

echo "[peer-bidirectional] Signaling host that doc has been synced..."
touch /shared/peer-wrote.txt

# Stay alive long enough for host to verify (host sleeps 2s then exits → compose stops all)
sleep 20

kill "$SERVER_PID" 2>/dev/null || true
echo "[peer-bidirectional] Done"
