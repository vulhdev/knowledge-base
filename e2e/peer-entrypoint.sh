#!/bin/sh
set -e

mkdir -p /data

INVITE=$(cat /shared/invite.txt)
echo "[peer] Joining with invite: $INVITE"

# cd to homedir so writeWorkspaceToClaude passes its home-directory guard
cd /root
node /app/dist/bin/cli.js team join --no-github-auth --username e2e-peer "$INVITE"

echo "[peer] Verifying synced docs..."
node /e2e/verify-peer.mjs

echo "[peer] E2E test PASSED"
