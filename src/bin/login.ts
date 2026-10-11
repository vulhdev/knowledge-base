#!/usr/bin/env node
import { loadSettings, writeSettings } from "../config.js";
import { initiateDeviceFlow, pollDeviceFlow } from "../auth/device-flow.js";
import { initiateRemoteDeviceFlow, pollRemoteDeviceToken } from "../auth/remote-login.js";
import { openDb } from "../db/client.js";
import { createSession } from "../auth/sessions.js";

const settings = loadSettings();
const serverArg = process.argv[2];
const isRemote = serverArg?.startsWith("http://") || serverArg?.startsWith("https://");

if (isRemote) {
  await runRemoteLogin(serverArg!);
} else {
  await runLocalLogin();
}

async function runRemoteLogin(serverUrl: string): Promise<void> {
  let deviceResp;
  try {
    deviceResp = await initiateRemoteDeviceFlow(serverUrl);
  } catch (err) {
    console.error(`Failed to reach server: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  console.log(`\nOpen this URL in your browser and enter the code:\n`);
  console.log(`  URL:  ${deviceResp.verification_uri}`);
  console.log(`  Code: ${deviceResp.user_code}\n`);
  console.log("Waiting for authorization...\n");

  const POLL_INTERVAL = Math.max(deviceResp.interval ?? 5, 5) * 1000;
  const EXPIRES_MS = (deviceResp.expires_in ?? 900) * 1000;
  const deadline = Date.now() + EXPIRES_MS;

  let sessionToken: string | null = null;
  let login: string | null = null;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    try {
      const data = await pollRemoteDeviceToken(serverUrl, deviceResp.device_code);
      if ("pending" in data && data.pending) continue;
      sessionToken = (data as { session_token: string; github_login: string }).session_token;
      login = (data as { session_token: string; github_login: string }).github_login;
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("expired_token")) {
        console.error("Device code expired. Please try again.");
        process.exit(1);
      }
      console.error(`Poll error: ${msg}`);
      process.exit(1);
    }
  }

  if (!sessionToken || !login) {
    console.error("Authorization timed out. Please try again.");
    process.exit(1);
  }

  writeSettings({ ...settings, server_url: serverUrl, session_token: sessionToken } as Parameters<typeof writeSettings>[0]);
  console.log(`\nLogged in as: ${login}`);
  console.log(`Connected to: ${serverUrl}\n`);
}

async function runLocalLogin(): Promise<void> {
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

  if (serverArg && !isRemote) {
    writeSettings({ ...settings, server_url: serverArg } as Parameters<typeof writeSettings>[0]);
  }

  console.log(`\nLogged in as: ${login}`);
  console.log(`\nSession token (add to your MCP config Authorization header):\n`);
  console.log(`  Bearer ${sessionToken}\n`);
}
