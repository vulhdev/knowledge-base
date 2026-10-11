#!/usr/bin/env node
import { loadSettings } from "../config.js";

const settings = loadSettings();
const { server_url: serverUrl, session_token: sessionToken } = settings;

const sessionId = process.argv[2];

if (!serverUrl || !sessionToken) {
  console.error("Error: not logged in. Run: knowledge-base login <server-url>");
  process.exit(1);
}

if (!sessionId) {
  console.error("Usage: knowledge-base rollback <session_id>");
  process.exit(1);
}

const res = await fetch(`${serverUrl}/api/import/${encodeURIComponent(sessionId)}`, {
  method: "DELETE",
  headers: { Authorization: `Bearer ${sessionToken}` },
});

if (!res.ok) {
  const body = (await res.json()) as { error?: string };
  console.error(`Rollback failed: ${body.error ?? res.statusText}`);
  process.exit(1);
}

console.log(`Rolled back import session: ${sessionId}`);
