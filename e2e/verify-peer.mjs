#!/usr/bin/env node
// Verifies the peer DB received at least 3 docs from the host after join+sync.
import { openDb } from "/app/dist/db/client.js";

const db = openDb();
const { count } = db.prepare("SELECT COUNT(*) AS count FROM contents").get();

if (count < 3) {
  console.error(`[verify-peer] FAIL: expected at least 3 docs, got ${count}`);
  process.exit(1);
}

console.log(`[verify-peer] PASS: ${count} doc(s) synced from host`);
