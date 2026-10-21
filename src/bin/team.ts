#!/usr/bin/env node
import * as p from "@clack/prompts";
import Hyperswarm from "hyperswarm";
import { loadSettings, writeSettings } from "../config.js";
import { openDb } from "../db/client.js";
import { generateNoiseKeypair } from "../team/generate.js";
import { generateInvite, normalizeGithubUsername, parseInviteCode } from "../team/invite.js";
import { startDeviceFlow, pollForToken, getGitHubUsername } from "../team/github.js";
import { kickPeer, listPeers, findPeerByUsername } from "../team/kick.js";
import { deriveJoinTopic } from "../sync/join.js";
import { startSync, type SyncHandle } from "../sync/index.js";
import { makeConsoleLogger } from "../sync/activity.js";
import { deriveTopicBuffer } from "../sync/peer.js";

const [, , , subcommand, ...args] = process.argv;

if (subcommand === "invite") {
  await runInvite(args);
} else if (subcommand === "join") {
  await runJoin(args);
} else if (subcommand === "list") {
  await runList(args);
} else if (subcommand === "kick") {
  await runKick(args);
} else if (subcommand === "server") {
  await runServer(args);
} else {
  console.error(`Unknown team subcommand: ${subcommand ?? "(none)"}`);
  console.error("Usage:");
  console.error("  knowledge-base team invite --workspace <name> @<github-username>");
  console.error("  knowledge-base team join <invite-code>");
  console.error("  knowledge-base team list --workspace <name>");
  console.error("  knowledge-base team kick @<github-username> --workspace <name>");
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

  const settings = loadSettings();
  const team = settings.workspaces?.[workspaceName]?.team;
  if (!team) {
    console.error(`Error: No team config found for workspace "${workspaceName}". Run "knowledge-base init" first.`);
    process.exit(1);
  }
  if (team.role !== "host") {
    console.error(`Error: Only the host can invite peers (your role is "${team.role}").`);
    process.exit(1);
  }

  const code = generateInvite(workspaceName, githubUsername);
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
    console.error(`Error: ${String(err)}`);
    process.exit(1);
  }

  p.intro("Joining team workspace");
  p.log.info("Authenticate with GitHub to verify your identity.");

  let githubToken: string;
  let githubUsername: string;
  try {
    const flow = await startDeviceFlow();
    p.log.info(`Open ${flow.verificationUri} and enter code: ${flow.userCode}`);
    const spinner = p.spinner();
    spinner.start("Waiting for GitHub authorization…");
    githubToken = await pollForToken(flow.deviceCode, flow.interval, flow.expiresIn);
    githubUsername = await getGitHubUsername(githubToken);
    spinner.stop(`Authenticated as @${githubUsername}`);
  } catch (err) {
    p.log.error(`GitHub authentication failed: ${String(err)}`);
    process.exit(1);
  }

  const kp = generateNoiseKeypair();
  const spinner = p.spinner();
  spinner.start(`Connecting to host…`);

  const swarm = new Hyperswarm({
    keyPair: {
      publicKey: Buffer.from(kp.publicKey, "hex"),
      secretKey: Buffer.from(kp.secretKey, "hex"),
    },
  });
  let result: { accepted: true; secret: string } | { accepted: false; reason: string };
  try {
    result = await Promise.race([
      attemptJoin(swarm, hostPublicKey, workspaceName, kp.publicKey, githubToken, githubUsername),
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          swarm.destroy().catch(() => undefined);
          reject(new Error("Host is not online, try again when host is running"));
        }, 30_000),
      ),
    ]);
  } catch (err: unknown) {
    spinner.stop("Connection failed");
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (!result.accepted) {
    spinner.stop("Join rejected");
    p.log.error(`Host rejected: ${result.reason}`);
    process.exit(1);
  }

  spinner.stop("Joined successfully");

  const fresh = loadSettings();
  fresh.workspaces ??= {};
  fresh.workspaces[workspaceName] ??= {};
  fresh.workspaces[workspaceName].team = {
    role: "peer",
    secret: result.secret,
    noise_keypair: kp,
    host_public_key: hostPublicKey,
  };
  fresh.identity = {
    ...(fresh.identity ?? { name: githubUsername, email: "" }),
    github_username: githubUsername,
  };
  writeSettings(fresh);

  p.outro(`Joined workspace "${workspaceName}" as @${githubUsername}`);
}

export async function attemptJoin(
  swarm: InstanceType<typeof Hyperswarm>,
  hostPublicKey: string,
  workspaceName: string,
  peerPublicKey: string,
  githubToken: string,
  githubUsername: string,
): Promise<{ accepted: true; secret: string } | { accepted: false; reason: string }> {
  const joinTopic = deriveJoinTopic(workspaceName, hostPublicKey);

  return new Promise((resolve, reject) => {
    swarm.join(joinTopic);

    swarm.on("connection", (socket: NodeJS.ReadWriteStream, info) => {
      if (info.publicKey.toString("hex") !== hostPublicKey) {
        (socket as import("node:stream").Duplex).destroy();
        return;
      }

      const msg = JSON.stringify({
        type: "join_request",
        githubToken,
        peerPublicKey,
        githubUsername,
      });
      (socket as NodeJS.WritableStream).write(msg + "\n");

      let buf = Buffer.alloc(0);
      (socket as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        const newline = buf.indexOf(0x0a);
        if (newline === -1) return;
        const line = buf.slice(0, newline).toString("utf8");
        swarm.destroy().catch(() => undefined);
        try {
          const result = JSON.parse(line) as { type: string; accepted: boolean; secret?: string; reason?: string };
          if (result.accepted && result.secret) {
            resolve({ accepted: true, secret: result.secret });
          } else {
            resolve({ accepted: false, reason: result.reason ?? "unknown" });
          }
        } catch {
          reject(new Error("Invalid response from host"));
        }
      });

      (socket as NodeJS.EventEmitter).on("error", (err: unknown) => {
        swarm.destroy().catch(() => undefined);
        reject(err);
      });
    });

    swarm.on("error", (...args: unknown[]) => reject(args[0]));
  });
}

async function runList(args: string[]): Promise<void> {
  const wsIdx = args.indexOf("--workspace");
  if (wsIdx === -1 || !args[wsIdx + 1]) {
    console.error("Error: --workspace <name> is required");
    process.exit(1);
  }
  const workspaceName = args[wsIdx + 1];

  const settings = loadSettings();
  const team = settings.workspaces?.[workspaceName]?.team;
  if (!team) {
    console.error(`Error: No team config found for workspace "${workspaceName}"`);
    process.exit(1);
  }
  if (team.role !== "host") {
    console.error("Error: Only the host can list team members");
    process.exit(1);
  }

  const db = openDb();
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

  const settings = loadSettings();
  const team = settings.workspaces?.[workspaceName]?.team;
  if (!team) {
    console.error(`Error: No team config found for workspace "${workspaceName}"`);
    process.exit(1);
  }
  if (team.role !== "host") {
    console.error("Error: Only the host can kick team members");
    process.exit(1);
  }

  const db = openDb();
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
  console.log(`✓ Removed @${githubUsername} from team`);
}

async function runServer(args: string[]): Promise<void> {
  const wsIdx = args.indexOf("--workspace");
  const targetWorkspace: string | null = wsIdx !== -1 ? (args[wsIdx + 1] ?? null) : null;

  const settings = loadSettings();
  const allWorkspaces = settings.workspaces ?? {};

  let workspaceNames: string[];
  if (targetWorkspace !== null) {
    if (!allWorkspaces[targetWorkspace]?.team) {
      console.error(`Error: No team config found for workspace "${targetWorkspace}"`);
      process.exit(1);
    }
    workspaceNames = [targetWorkspace];
  } else {
    workspaceNames = Object.entries(allWorkspaces)
      .filter(([, ws]) => ws.team !== undefined)
      .map(([name]) => name);
    if (workspaceNames.length === 0) {
      console.error("Error: No team workspaces configured.");
      process.exit(1);
    }
  }

  const db = openDb();
  const logger = makeConsoleLogger();
  const handles: SyncHandle[] = [];

  console.log(`Sync server started — watching ${workspaceNames.length} workspace(s)\n`);
  for (const name of workspaceNames) {
    const team = allWorkspaces[name].team!;
    const topic = deriveTopicBuffer(name, team.secret).toString("hex");
    const handle = startSync(db, name, logger);
    if (!handle) {
      console.log(`  ${name.padEnd(20)} ⚠ Sync already running for this workspace — skipping`);
      continue;
    }
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
