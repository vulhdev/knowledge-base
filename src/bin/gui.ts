#!/usr/bin/env node
import { openDb } from "../db/client.js";
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
