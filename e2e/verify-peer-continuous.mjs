#!/usr/bin/env node
// Verifies the peer DB received the host's doc update in the continuous sync scenario.
import { openDb } from "/app/dist/db/client.js";

const EXPECTED_BODY = "updated-by-host";

const db = openDb();
const row = db.prepare("SELECT id FROM contents WHERE body = ?").get(EXPECTED_BODY);

if (!row) {
  console.error(`[verify-peer-continuous] FAIL: no content with body="${EXPECTED_BODY}" found`);
  process.exit(1);
}

console.log(`[verify-peer-continuous] PASS: found updated content id=${row.id}`);
