#!/usr/bin/env node
// Verifies the host DB received the doc written by the peer in the bidirectional scenario.
import { openDb } from "/app/dist/db/client.js";

const EXPECTED_BODY = "from-peer-bidirectional";

const db = openDb();
const row = db.prepare("SELECT id FROM contents WHERE body = ?").get(EXPECTED_BODY);

if (!row) {
  console.error(`[verify-host-bidirectional] FAIL: no content with body="${EXPECTED_BODY}" found`);
  process.exit(1);
}

console.log(`[verify-host-bidirectional] PASS: found content id=${row.id} from peer`);
