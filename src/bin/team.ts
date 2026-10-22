#!/usr/bin/env node
import type Database from "better-sqlite3";
import * as p from "@clack/prompts";
import Hyperswarm from "hyperswarm";
import HyperDHT from "hyperdht";
import { loadSettings, writeSettings } from "../config.js";
import { openDb } from "../db/client.js";
import { getTeamByName, insertTeam, listTeamWorkspaces } from "../db/team.js";
import { createWorkspace } from "../db/workspaces.js";
import { writeWorkspaceToClaude } from "../sync/claude-md.js";
import { generateNoiseKeypair } from "../team/generate.js";
import { generateInvite, normalizeGithubUsername, parseInviteCode } from "../team/invite.js";
import { startDeviceFlow, pollForToken, getGitHubUsername } from "../team/github.js";
import { kickPeer, listPeers, findPeerByUsername, deletePeer } from "../team/kick.js";
import { deriveJoinTopic } from "../sync/join.js";
import { HOST_VERSION } from "../sync/version.js";
import type { Duplex } from "node:stream";
import { startSync, type SyncHandle } from "../sync/index.js";
import { makeConsoleLogger, makeFileLogger, type ActivityLogger } from "../sync/activity.js";
import { logInfo, logWarn, logError } from "../log/logger.js";

function makeCompositeLogger(a: ActivityLogger, b: ActivityLogger): ActivityLogger {
  return {
    onPeerConnect: (...args) => { a.onPeerConnect(...args); b.onPeerConnect(...args); },
    onPeerDisconnect: (...args) => { a.onPeerDisconnect(...args); b.onPeerDisconnect(...args); },
    onChangesetReceived: (...args) => { a.onChangesetReceived(...args); b.onChangesetReceived(...args); },
    onChangesetSent: (...args) => { a.onChangesetSent(...args); b.onChangesetSent(...args); },
    onJoinConnect: (...args) => { a.onJoinConnect(...args); b.onJoinConnect(...args); },
    onJoinAttempt: (...args) => { a.onJoinAttempt(...args); b.onJoinAttempt(...args); },
    onJoinResult: (...args) => { a.onJoinResult(...args); b.onJoinResult(...args); },
  };
}
import { deriveTopicBuffer } from "../sync/peer.js";
import { performInitialSyncOnSocket } from "../sync/initial.js";
import { mergeWorkspace } from "../sync/merge.js";
import { listWorkspaces } from "../db/workspaces.js";

const [, , , subcommand, ...args] = process.argv;

if (subcommand === "invite") {
  await runInvite(args);
} else if (subcommand === "join") {
  await runJoin(args);
} else if (subcommand === "list") {
  await runList(args);
} else if (subcommand === "kick") {
  await runKick(args);
} else if (subcommand === "delete") {
  await runDelete(args);
} else if (subcommand === "server") {
  await runServer(args);
} else {
  console.error(`Unknown team subcommand: ${subcommand ?? "(none)"}`);
  console.error("Usage:");
  console.error("  knowledge-base team invite --workspace <name> @<github-username>");
  console.error("  knowledge-base team join <invite-code>");
  console.error("  knowledge-base team list --workspace <name>");
  console.error("  knowledge-base team kick @<github-username> --workspace <name>");
  console.error("  knowledge-base team delete @<github-username> --workspace <name>");
  console.error("  knowledge-base team server [--workspace <name>]");
  process.exit(1);
}

async function runInvite(args: string[]): Promise<void> {
  const wsIdx = args.indexOf("--workspace");
  if (wsIdx === -1 || !args[wsIdx + 1]) {
    console.error("Error: --workspace <name> is required");
    process.exit(1);
  }
  const workspaceName = args[wsIdx + 1];
  const usernameRaw = args.find((a) => !a.startsWith("--") && a !== args[wsIdx + 1]);
  if (!usernameRaw) {
    console.error("Error: GitHub username is required (e.g. @vulhdev)");
    process.exit(1);
  }

  let githubUsername: string;
  try {
    githubUsername = normalizeGithubUsername(usernameRaw);
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }

  const db = openDb();
  logInfo("team_invite", { event: "start", workspace: workspaceName, github: githubUsername });
  const code = generateInvite(db, workspaceName, githubUsername);
  logInfo("team_invite", { event: "done", workspace: workspaceName, github: githubUsername });
  p.log.success(`Invite created for @${githubUsername}`);
  p.log.info(`Share this invite code:`);
  console.log(`\n  ${code}\n`);
  p.log.info(`Peer runs: knowledge-base team join ${code}`);
}

async function runJoin(args: string[]): Promise<void> {
  const inviteCode = args[0];
  if (!inviteCode) {
    console.error("Error: invite code is required");
    console.error("Usage: knowledge-base team join <invite-code>");
    process.exit(1);
  }

  let hostPublicKey: string;
  let workspaceName: string;
  try {
    ({ hostPublicKey, workspaceName } = parseInviteCode(inviteCode));
  } catch (err) {
    logError("team_join", err instanceof Error ? err : new Error(String(err)));
    logInfo("team_join", { event: "parse_invite_failed", reason: String(err) });
    console.error(`Error: ${String(err)}`);
    process.exit(1);
  }

  logInfo("team_join", { event: "start", workspace: workspaceName });
  p.intro("Joining team workspace");

  const authArgs = parseGitHubAuthArgs(args);
  if (authArgs.noAuth === "error") {
    console.error(`Error: ${authArgs.message}`);
    process.exit(1);
  }

  let githubToken: string;
  let githubUsername: string;
  if (authArgs.noAuth) {
    githubToken = "no-github-auth-token";
    githubUsername = authArgs.username;
    logInfo("team_join", { event: "github_auth_skip", github: githubUsername });
    p.log.info(`Skipping GitHub auth (--no-github-auth) — joining as @${githubUsername}`);
  } else {
    p.log.info("Authenticate with GitHub to verify your identity.");
    logInfo("team_join", { event: "github_auth_start" });
    try {
      const flow = await startDeviceFlow();
      p.log.info(`Open ${flow.verificationUri} and enter code: ${flow.userCode}`);
      const spinner = p.spinner();
      spinner.start("Waiting for GitHub authorization…");
      githubToken = await pollForToken(flow.deviceCode, flow.interval, flow.expiresIn);
      githubUsername = await getGitHubUsername(githubToken);
      spinner.stop(`Authenticated as @${githubUsername}`);
      logInfo("team_join", { event: "github_auth_done", github: githubUsername });
    } catch (err) {
      logError("team_join", err instanceof Error ? err : new Error(String(err)));
      logInfo("team_join", { event: "github_auth_failed", reason: String(err) });
      p.log.error(`GitHub authentication failed: ${String(err)}`);
      process.exit(1);
    }
  }

  const kp = generateNoiseKeypair();
  const spinner = p.spinner();
  const joinTopic = deriveJoinTopic(workspaceName, hostPublicKey);
  const topicHex = joinTopic.toString("hex").slice(0, 12);
  spinner.start(`Connecting to host… (topic: ${topicHex}…)`);

  const bootstrapEnv = process.env.KB_DHT_BOOTSTRAP;
  const bootstrap = bootstrapEnv
    ? bootstrapEnv.split(",").map((addr) => {
        const [host, portStr] = addr.split(":");
        return { host: host ?? "127.0.0.1", port: Number(portStr) };
      })
    : undefined;
  // KB_DHT_OPEN=1: same firewalled=false fix as createSwarm — needed for Docker bridge E2E.
  const dhtNode = process.env.KB_DHT_OPEN === "1"
    ? new HyperDHT({ ...(bootstrap && { bootstrap }), firewalled: false })
    : undefined;
  const swarm = new Hyperswarm({
    keyPair: {
      publicKey: Buffer.from(kp.publicKey, "hex"),
      secretKey: Buffer.from(kp.secretKey, "hex"),
    },
    ...(dhtNode ? { dht: dhtNode } : (bootstrap && { bootstrap })),
  });

  logInfo("team_join", { event: "connect_start", workspace: workspaceName, topic: topicHex });
  const diagnostics: string[] = [];
  const onDiagnostic = (msg: string) => {
    diagnostics.push(msg);
    logInfo("team_join", { event: "connect_diagnostic", msg });
    spinner.message(`Connecting… ${msg}`);
  };

  let result: { accepted: true; secret: string; socket: NodeJS.ReadWriteStream; remainder: Buffer } | { accepted: false; reason: string };
  try {
    result = await Promise.race([
      attemptJoin(swarm, hostPublicKey, workspaceName, kp.publicKey, githubToken, githubUsername, onDiagnostic),
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          swarm.destroy().catch(() => undefined);
          reject(new Error(
            `Host not reachable after 30s\n` +
            `  topic:   ${topicHex}…\n` +
            `  host:    ${hostPublicKey.slice(0, 12)}…\n` +
            `  version: ${HOST_VERSION}\n` +
            (diagnostics.length > 0 ? `  events:  ${diagnostics.join("; ")}\n` : "") +
            `  Check: team server is running on host, UDP ports are open, same major.minor version`,
          ));
        }, 30_000),
      ),
    ]);
  } catch (err: unknown) {
    logError("team_join", err instanceof Error ? err : new Error(String(err)));
    logInfo("team_join", { event: "connect_timeout", diagnostics: diagnostics.join("; ") });
    spinner.stop("Connection failed");
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (!result.accepted) {
    logWarn("team_join", { event: "connect_rejected", workspace: workspaceName, reason: result.reason });
    spinner.stop("Join rejected");
    p.log.error(`Host rejected: ${result.reason}`);
    process.exit(1);
  }

  logInfo("team_join", { event: "connect_accepted", workspace: workspaceName });
  spinner.stop("Joined successfully");

  const db = openDb();
  const ws = createWorkspace(db, workspaceName);
  insertTeam(db, ws.id, {
    role: "peer",
    secret: result.secret,
    noise_public_key: kp.publicKey,
    noise_secret_key: kp.secretKey,
    host_public_key: hostPublicKey,
    last_synced_at: null,
  });
  writeWorkspaceToClaude(workspaceName);

  const fresh = loadSettings();
  fresh.identity = {
    ...(fresh.identity ?? { name: githubUsername, email: "" }),
    github_username: githubUsername,
  };
  writeSettings(fresh);

  p.outro(`Joined workspace "${workspaceName}" as @${githubUsername}`);

  const syncSpinner = p.spinner();
  syncSpinner.start("Syncing data from host… do not close terminal");
  logInfo("team_join", { event: "initial_sync_start", workspace: workspaceName });
  // Reuse the join socket — host calls handleSyncConnection on it right after sending
  // join_result, so no new DHT round-trip is needed and there is no timeout risk.
  const syncResult = await performInitialSyncOnSocket(db, workspaceName, result.socket, result.remainder);
  await swarm.destroy().catch(() => undefined);
  if (syncResult.ok) {
    logInfo("team_join", { event: "initial_sync_done", workspace: workspaceName, rows: String(syncResult.rowsReceived) });
    syncSpinner.stop(`Sync complete — ${syncResult.rowsReceived} rows received`);
  } else {
    logWarn("team_join", { event: "initial_sync_skipped", workspace: workspaceName, reason: syncResult.reason });
    syncSpinner.stop(`Sync skipped (${syncResult.reason})`);
  }

  await promptMerge(db, workspaceName);
  logInfo("team_join", { event: "done", workspace: workspaceName, github: githubUsername });
}

export function parseGitHubAuthArgs(
  args: string[],
): { noAuth: true; username: string } | { noAuth: false } | { noAuth: "error"; message: string } {
  if (!args.includes("--no-github-auth")) return { noAuth: false };
  const idx = args.indexOf("--username");
  if (idx === -1 || !args[idx + 1]) {
    return { noAuth: "error", message: "--username <name> is required with --no-github-auth" };
  }
  return { noAuth: true, username: args[idx + 1] };
}

export async function promptMerge(
  db: Database.Database,
  teamWorkspaceName: string,
): Promise<void> {
  const allWorkspaces = listWorkspaces(db);
  const teamNames = new Set(listTeamWorkspaces(db).map((w) => w.name));
  const candidates = allWorkspaces.filter((w) => !teamNames.has(w.name));
  if (candidates.length === 0) return;

  const choice = await p.select({
    message: "Merge an existing local workspace into the team workspace? (optional)",
    options: [
      { label: "Skip", value: null },
      ...candidates.map((w) => ({ label: w.name, value: w.name })),
    ],
  });
  if (p.isCancel(choice) || choice === null) return;

  const confirmed = await p.confirm({
    message: `Merge all docs from "${choice}" into "${teamWorkspaceName}"?`,
  });
  if (p.isCancel(confirmed) || !confirmed) return;

  const result = mergeWorkspace(db, choice, teamWorkspaceName);
  p.log.success(
    `Merged: ${result.featuresMoved} feature(s) moved` +
    (result.featuresRenamed.length > 0 ? `, ${result.featuresRenamed.length} renamed` : ""),
  );
}

export async function attemptJoin(
  swarm: InstanceType<typeof Hyperswarm>,
  hostPublicKey: string,
  workspaceName: string,
  peerPublicKey: string,
  githubToken: string,
  githubUsername: string,
  onDiagnostic?: (msg: string) => void,
): Promise<{ accepted: true; secret: string; socket: NodeJS.ReadWriteStream; remainder: Buffer } | { accepted: false; reason: string }> {
  const joinTopic = deriveJoinTopic(workspaceName, hostPublicKey);

  return new Promise((resolve, reject) => {
    swarm.join(joinTopic);

    swarm.on("connection", (socket: NodeJS.ReadWriteStream, info) => {
      if (info.publicKey.toString("hex") !== hostPublicKey) {
        onDiagnostic?.(`key mismatch: got ${info.publicKey.toString("hex").slice(0, 12)}…, expected ${hostPublicKey.slice(0, 12)}… — ignoring`);
        (socket as Duplex).destroy();
        return;
      }

      const msg = JSON.stringify({
        type: "join_request",
        githubToken,
        peerPublicKey,
        githubUsername,
        appVersion: HOST_VERSION,
      });
      (socket as NodeJS.WritableStream).write(msg + "\n");

      let buf = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        const newline = buf.indexOf(0x0a);
        if (newline === -1) return;
        const line = buf.slice(0, newline).toString("utf8");
        // Remove this listener so the socket is clean for the sync protocol handler.
        // Pause immediately after to prevent incoming bytes from being discarded while
        // the stream has no "data" listener — handleSyncConnection will resume it.
        (socket as NodeJS.ReadableStream).removeListener("data", onData);
        (socket as NodeJS.ReadableStream).pause();
        try {
          const result = JSON.parse(line) as { type: string; accepted: boolean; secret?: string; reason?: string };
          if (result.accepted && result.secret) {
            // Keep swarm alive — caller reuses socket for sync, then destroys swarm
            resolve({ accepted: true, secret: result.secret, socket, remainder: buf.slice(newline + 1) });
          } else {
            swarm.destroy().catch(() => undefined);
            resolve({ accepted: false, reason: result.reason ?? "unknown" });
          }
        } catch {
          swarm.destroy().catch(() => undefined);
          reject(new Error("Invalid response from host"));
        }
      };
      (socket as NodeJS.ReadableStream).on("data", onData);

      (socket as NodeJS.EventEmitter).on("error", (err: unknown) => {
        swarm.destroy().catch(() => undefined);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });

    swarm.on("error", (...args: unknown[]) => {
      const err = args[0] instanceof Error ? args[0] : new Error(String(args[0]));
      onDiagnostic?.(`swarm error: ${err.message}`);
      reject(err);
    });
  });
}

async function runList(args: string[]): Promise<void> {
  const wsIdx = args.indexOf("--workspace");
  if (wsIdx === -1 || !args[wsIdx + 1]) {
    console.error("Error: --workspace <name> is required");
    process.exit(1);
  }
  const workspaceName = args[wsIdx + 1];

  const db = openDb();
  const team = getTeamByName(db, workspaceName);
  if (!team) {
    console.error(`Error: No team config found for workspace "${workspaceName}"`);
    process.exit(1);
  }
  if (team.role !== "host") {
    console.error("Error: Only the host can list team members");
    process.exit(1);
  }
  const peers = listPeers(db);

  if (peers.length === 0) {
    console.log("(No members yet)");
    return;
  }

  console.log("Status  Username                         Joined");
  for (const peer of peers) {
    const marker = peer.is_active ? "●" : "○";
    const username = peer.github_username ? `@${peer.github_username}` : peer.display_name;
    const label = peer.is_active ? username : `${username} (kicked)`;
    const joined = peer.joined_at.slice(0, 10);
    console.log(`${marker}       ${label.padEnd(33)}${joined}`);
  }
}

async function runKick(args: string[]): Promise<void> {
  const wsIdx = args.indexOf("--workspace");
  if (wsIdx === -1 || !args[wsIdx + 1]) {
    console.error("Error: --workspace <name> is required");
    process.exit(1);
  }
  const workspaceName = args[wsIdx + 1];
  const usernameRaw = args.find((a) => !a.startsWith("--") && a !== args[wsIdx + 1]);
  if (!usernameRaw) {
    console.error("Error: GitHub username is required (e.g. @alice)");
    process.exit(1);
  }

  let githubUsername: string;
  try {
    githubUsername = normalizeGithubUsername(usernameRaw);
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }

  const db = openDb();
  const team = getTeamByName(db, workspaceName);
  if (!team) {
    console.error(`Error: No team config found for workspace "${workspaceName}"`);
    process.exit(1);
  }
  if (team.role !== "host") {
    console.error("Error: Only the host can kick team members");
    process.exit(1);
  }
  const peer = findPeerByUsername(db, githubUsername);
  if (!peer) {
    console.error(`Error: Member not found: @${githubUsername}`);
    process.exit(1);
  }
  if (peer.is_active === 0) {
    console.error(`Error: Member @${githubUsername} is already inactive`);
    process.exit(1);
  }

  kickPeer(db, peer.public_key);
  logInfo("team_kick", { event: "done", workspace: workspaceName, github: githubUsername });
  console.log(`✓ Removed @${githubUsername} from team`);
}

async function runDelete(args: string[]): Promise<void> {
  const wsIdx = args.indexOf("--workspace");
  if (wsIdx === -1 || !args[wsIdx + 1]) {
    console.error("Error: --workspace <name> is required");
    process.exit(1);
  }
  const workspaceName = args[wsIdx + 1];
  const usernameRaw = args.find((a) => !a.startsWith("--") && a !== args[wsIdx + 1]);
  if (!usernameRaw) {
    console.error("Error: GitHub username is required (e.g. @alice)");
    process.exit(1);
  }

  let githubUsername: string;
  try {
    githubUsername = normalizeGithubUsername(usernameRaw);
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }

  const db = openDb();
  const team = getTeamByName(db, workspaceName);
  if (!team) {
    console.error(`Error: No team config found for workspace "${workspaceName}"`);
    process.exit(1);
  }
  if (team.role !== "host") {
    console.error("Error: Only the host can delete team members");
    process.exit(1);
  }

  const peer = findPeerByUsername(db, githubUsername);
  if (!peer) {
    console.error(`Error: Member not found: @${githubUsername}`);
    process.exit(1);
  }

  try {
    deletePeer(db, peer.public_key);
  } catch (err) {
    console.error(`Error: ${String(err).replace("Error: ", "")}`);
    process.exit(1);
  }

  logInfo("team_delete", { event: "done", workspace: workspaceName, github: githubUsername });
  console.log(`✓ @${githubUsername} has been removed. You can now re-invite them.`);
}

async function runServer(args: string[]): Promise<void> {
  const wsIdx = args.indexOf("--workspace");
  const targetWorkspace: string | null = wsIdx !== -1 ? (args[wsIdx + 1] ?? null) : null;

  const db = openDb();

  let workspaceNames: string[];
  if (targetWorkspace !== null) {
    if (!getTeamByName(db, targetWorkspace)) {
      console.error(`Error: No team config found for workspace "${targetWorkspace}"`);
      process.exit(1);
    }
    workspaceNames = [targetWorkspace];
  } else {
    workspaceNames = listTeamWorkspaces(db).map((ws) => ws.name);
    if (workspaceNames.length === 0) {
      console.error("Error: No team workspaces configured.");
      process.exit(1);
    }
  }

  logInfo("team_server", { event: "start", workspaces: workspaceNames.join(",") });
  const logger = makeCompositeLogger(makeConsoleLogger(), makeFileLogger());
  const handles: SyncHandle[] = [];

  console.log(`Sync server started — watching ${workspaceNames.length} workspace(s)\n`);
  for (const name of workspaceNames) {
    const team = getTeamByName(db, name)!;
    const topic = deriveTopicBuffer(name, team.secret).toString("hex");
    const handle = startSync(db, name, logger);
    if (!handle) {
      logWarn("team_server", { event: "workspace_skip", workspace: name, reason: "already_running" });
      console.log(`  ${name.padEnd(20)} ⚠ Sync already running for this workspace — skipping`);
      continue;
    }
    logInfo("team_server", { event: "workspace_started", workspace: name, role: team.role });
    console.log(`  ${name.padEnd(20)} topic: ${topic.slice(0, 6)}…   role: ${team.role}`);
    handles.push(handle);
  }
  console.log("");

  if (handles.length === 0) {
    console.log("All workspaces already have a running sync daemon. Exiting.");
    process.exit(0);
  }

  const shutdown = async () => {
    console.log("\nShutting down…");
    await Promise.all(handles.map((h) => h.destroy()));
    process.exit(0);
  };

  process.on("SIGINT", () => { shutdown().catch(() => process.exit(1)); });
  process.on("SIGTERM", () => { shutdown().catch(() => process.exit(1)); });
}
