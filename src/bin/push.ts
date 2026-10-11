#!/usr/bin/env node
import readline from "node:readline";
import { openDb } from "../db/client.js";
import { loadSettings } from "../config.js";
import { fetchWorkspaceItems } from "./push-helpers.js";

const settings = loadSettings();
const { server_url: serverUrl, session_token: sessionToken } = settings;

if (!serverUrl || !sessionToken) {
  console.error("Error: not logged in. Run: knowledge-base login <server-url>");
  process.exit(1);
}

const db = openDb();

let workspace: string | undefined = process.argv[2];

if (!workspace) {
  const rows = db.prepare("SELECT name FROM workspaces ORDER BY name").all() as { name: string }[];
  if (rows.length === 0) {
    console.error("No workspaces found in local database.");
    process.exit(1);
  }
  if (rows.length === 1) {
    workspace = rows[0].name;
  } else {
    console.log("Available workspaces:");
    rows.forEach((r, i) => console.log(`  ${i + 1}. ${r.name}`));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((res) => rl.question("Enter workspace name or number: ", res));
    rl.close();
    const idx = parseInt(answer, 10);
    workspace = isNaN(idx) ? answer.trim() : (rows[idx - 1]?.name ?? answer.trim());
  }
}

const items = fetchWorkspaceItems(db, workspace);

if (items.length === 0) {
  console.error(`No contents found in workspace "${workspace}".`);
  process.exit(1);
}

console.log(`\nPushing ${items.length} document(s) from "${workspace}" to ${serverUrl}...`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const confirm = await new Promise<string>((res) => rl.question("Proceed? [y/N] ", res));
rl.close();

if (confirm.trim().toLowerCase() !== "y") {
  console.log("Cancelled.");
  process.exit(0);
}

const res = await fetch(`${serverUrl}/api/import`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
  body: JSON.stringify({ workspace, items }),
});

if (!res.ok) {
  const body = (await res.json()) as { error?: string };
  console.error(`Push failed: ${body.error ?? res.statusText}`);
  process.exit(1);
}

const data = (await res.json()) as { session_id: string; imported: number };
console.log(`\nPush complete: ${data.imported} document(s) imported.`);
console.log(`Session ID: ${data.session_id}`);
console.log(`To rollback: knowledge-base rollback ${data.session_id}\n`);
