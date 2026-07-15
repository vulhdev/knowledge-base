#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { openDb } from "../db/client.js";

process.env.DB_PATH ??= join(homedir(), ".claude", "knowledge-base.db");
import { createApp } from "../gui/server.js";

const port = Number(process.env.PORT ?? 3000);

let db;
try {
  db = openDb();
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

createApp(db).listen(port, () => {
  console.log(`knowledge-base gui listening on http://localhost:${port}`);
});
