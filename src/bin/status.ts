#!/usr/bin/env node
import * as p from "@clack/prompts";
import { openDb } from "../db/client.js";
import { listTeamWorkspaces, getTeamByName } from "../db/team.js";
import { createSwarm } from "../sync/peer.js";
import type Database from "better-sqlite3";

const PROBE_TIMEOUT_MS = 10_000;

export function formatTimeAgoForTest(iso: string): string {
  return formatTimeAgo(iso);
}

function formatTimeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return `${diffSecs} seconds ago`;
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

export { resolveWorkspace as resolveWorkspaceForTest };

async function resolveWorkspace(db: Database.Database): Promise<string | null> {
  const teamWorkspaces = listTeamWorkspaces(db).map((ws) => ws.name);

  const arg = process.argv[3];
  if (arg) {
    if (!teamWorkspaces.includes(arg)) {
      console.log(`Workspace "${arg}" has no team mode configured.`);
      console.log("Run: knowledge-base init");
      return null;
    }
    return arg;
  }

  if (teamWorkspaces.length === 0) {
    console.log("No workspaces with team mode configured.");
    console.log("Run: knowledge-base init");
    return null;
  }

  if (teamWorkspaces.length === 1) return teamWorkspaces[0];

  const selected = await p.select<string>({
    message: "Select a workspace:",
    options: teamWorkspaces.map((name) => ({ value: name, label: name })),
  });

  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    return null;
  }

  return selected;
}

async function main(): Promise<void> {
  const db = openDb();
  const workspaceName = await resolveWorkspace(db);
  if (!workspaceName) {
    process.exit(0);
  }

  const team = getTeamByName(db, workspaceName)!;

  console.log(`\nWorkspace : ${workspaceName}  (role: ${team.role})`);

  const { swarm, destroy } = createSwarm(db, workspaceName);

  const connectedKeys = new Set<string>();

  swarm.on("connection", (_socket: unknown, info: { publicKey: Buffer }) => {
    connectedKeys.add(info.publicKey.toString("hex"));
  });

  const spinner = p.spinner();
  spinner.start(`Probing for peers… (${PROBE_TIMEOUT_MS / 1000}s timeout)`);

  await new Promise<void>((resolve) => setTimeout(resolve, PROBE_TIMEOUT_MS));

  await Promise.race([
    destroy(),
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);

  spinner.stop("Done.");

  if (team.role === "host") {
    type PeerRow = { public_key: string; display_name: string; is_active: number; joined_at: string };
    const peers = db
      .prepare("SELECT public_key, display_name, is_active, joined_at FROM team_peers ORDER BY joined_at ASC")
      .all() as PeerRow[];

    console.log("\nPeers");
    if (peers.length === 0) {
      console.log("  (No peers have joined yet)");
    } else {
      for (const peer of peers) {
        if (!peer.is_active) continue;
        const online = connectedKeys.has(peer.public_key);
        const status = online ? "online " : "offline";
        const marker = online ? "●" : "○";
        const joinedDate = peer.joined_at.slice(0, 10);
        console.log(`  ${marker} ${peer.display_name.padEnd(28)} ${status}   (joined ${joinedDate})`);
      }
    }
  } else {
    const isOnline = connectedKeys.size > 0;
    const lastSync = team.last_synced_at
      ? `${formatTimeAgo(team.last_synced_at)}  (${team.last_synced_at.slice(0, 16).replace("T", " ")})`
      : "Never synced";

    console.log(`\nConnection : ${isOnline ? "online" : "offline"}`);
    console.log(`Last sync  : ${lastSync}`);
  }

  console.log("");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
