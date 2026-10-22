#!/usr/bin/env node
// Custom host server for the continuous sync E2E scenario.
// Runs startSync in the SAME process so pushToAllWorkspaces() shares the pusher registry
// with the sync connection handlers (pusher registry is module-level state).
// Polls /shared/trigger-push.txt (polling beats fs.watch on Docker volume mounts).
import { existsSync, writeFileSync } from "node:fs";
import { openDb } from "/app/dist/db/client.js";
import { startSync } from "/app/dist/sync/index.js";
import { pushToAllWorkspaces } from "/app/dist/sync/push.js";

const WORKSPACE = "e2e-workspace";
const UPDATED_BODY = "updated-by-host";

const db = openDb();
startSync(db, WORKSPACE);
console.log("[host-continuous-server] sync started, polling for trigger-push.txt...");

let triggered = false;
const poll = setInterval(() => {
  if (triggered || !existsSync("/shared/trigger-push.txt")) return;
  triggered = true;
  clearInterval(poll);

  const target = db.prepare("SELECT id FROM contents WHERE body LIKE 'E2E seed%' LIMIT 1").get();
  if (!target) {
    console.error("[host-continuous-server] WARN: no seeded doc found to update");
  } else {
    db.prepare("UPDATE contents SET body = ? WHERE id = ?").run(UPDATED_BODY, target.id);
    console.log(`[host-continuous-server] updated content id=${target.id} body="${UPDATED_BODY}"`);
  }

  pushToAllWorkspaces();
  console.log("[host-continuous-server] pushed delta to all connected peers");
  writeFileSync("/shared/host-edited.txt", "done");
}, 500);
