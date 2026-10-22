#!/bin/sh
set -e

mkdir -p /data

# settings.json was created during Docker build (CRSQLite pre-download side effect).
# Delete it so the DB_PATH env var is used for db_path on first openDb() call.
rm -f /root/.claude/knowledge-base/settings.json

INVITE=$(cat /shared/invite.txt)
echo "[peer] Joining with invite: $INVITE"

# cd to homedir so writeWorkspaceToClaude passes its home-directory guard
cd /root
node /app/dist/bin/cli.js team join --no-github-auth --username e2e-peer "$INVITE"

echo "[peer] Verifying synced docs..."
node /e2e/verify-peer.mjs

echo "[peer] E2E test PASSED"
