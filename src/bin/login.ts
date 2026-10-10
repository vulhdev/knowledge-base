#!/usr/bin/env node
import { loadSettings, writeSettings } from "../config.js";
import { initiateDeviceFlow, pollDeviceFlow } from "../auth/device-flow.js";
import { openDb } from "../db/client.js";
import { createSession } from "../auth/sessions.js";

const settings = loadSettings();
const clientId = settings.github_client_id;

if (!clientId) {
  console.error(
    "Error: github_client_id not set in settings. Run: knowledge-base init --mode server"
  );
  process.exit(1);
}

let deviceResp;
try {
  deviceResp = await initiateDeviceFlow(clientId);
} catch (err) {
  console.error(`Failed to start device flow: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

console.log(`\nOpen this URL in your browser and enter the code:\n`);
console.log(`  URL:  ${deviceResp.verification_uri}`);
console.log(`  Code: ${deviceResp.user_code}\n`);
console.log("Waiting for authorization...\n");

const POLL_INTERVAL = Math.max(deviceResp.interval ?? 5, 5) * 1000;
const EXPIRES_MS = (deviceResp.expires_in ?? 900) * 1000;
const deadline = Date.now() + EXPIRES_MS;

let token: string | null = null;
let login: string | null = null;

while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, POLL_INTERVAL));

  try {
    const result = await pollDeviceFlow(
      clientId,
      process.env.GITHUB_CLIENT_SECRET ?? "",
      deviceResp.device_code
    );

    if ("pending" in result && result.pending) continue;

    token = (result as { access_token: string; github_login: string }).access_token;
    login = (result as { access_token: string; github_login: string }).github_login;
    break;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("slow_down")) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
      continue;
    }
    console.error(`Auth error: ${msg}`);
    process.exit(1);
  }
}

if (!token || !login) {
  console.error("Authorization timed out. Please try again.");
  process.exit(1);
}

const db = openDb();
const sessionToken = createSession(db, login);

const serverUrl = process.argv[2] ?? process.env.KB_SERVER_URL ?? "";
if (serverUrl) {
  writeSettings({ ...settings, server_url: serverUrl } as Parameters<typeof writeSettings>[0]);
}

console.log(`\nLogged in as: ${login}`);
console.log(`\nSession token (add to your MCP config Authorization header):\n`);
console.log(`  Bearer ${sessionToken}\n`);
