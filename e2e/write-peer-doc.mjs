#!/usr/bin/env node
// Inserts 1 doc into the peer DB as a CRR-tracked row.
// Relies on openDb() which loads CRSQLite and applies migrations.
import { openDb } from "/app/dist/db/client.js";

const WORKSPACE = "e2e-workspace";
const BODY = "from-peer-bidirectional";

const db = openDb();

const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(WORKSPACE);
if (!ws) {
  console.error(`[write-peer-doc] workspace "${WORKSPACE}" not found — was initial sync skipped?`);
  process.exit(1);
}

const feature = db
  .prepare("SELECT id FROM features WHERE workspace_id = ? LIMIT 1")
  .get(ws.id);
if (!feature) {
  console.error("[write-peer-doc] no features found in workspace");
  process.exit(1);
}

const row = db
  .prepare("INSERT INTO contents (type, title, body) VALUES (?, ?, ?) RETURNING id")
  .get("doc", "peer bidirectional doc", BODY);
db.prepare("INSERT INTO content_features (content_id, feature_id) VALUES (?, ?)").run(row.id, feature.id);

console.log(`[write-peer-doc] inserted content id=${row.id} body="${BODY}"`);
