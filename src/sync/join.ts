import { createHash } from "node:crypto";
import { loadSettings, writeSettings } from "../config.js";
import type Database from "better-sqlite3";

export type JoinRequest = {
  pendingToken: string;
  displayName: string;
  peerPublicKey: string;
};

export type JoinResult =
  | { accepted: true; secret: string }
  | { accepted: false; reason: string };

export function deriveJoinTopic(workspaceName: string): Buffer {
  return createHash("sha256").update(`${workspaceName}:join`).digest();
}

export function handleJoinRequest(
  db: Database.Database,
  workspaceName: string,
  req: JoinRequest,
): JoinResult {
  const settings = loadSettings();
  const team = settings.workspaces?.[workspaceName]?.team;
  if (!team) return { accepted: false, reason: "workspace not found" };
  if (!team.pending_token) return { accepted: false, reason: "no pending invite" };
  if (team.pending_token !== req.pendingToken) return { accepted: false, reason: "invalid token" };

  db.prepare(
    "INSERT OR IGNORE INTO team_peers (public_key, display_name) VALUES (?, ?)",
  ).run(req.peerPublicKey, req.displayName);

  const updated = loadSettings();
  if (updated.workspaces?.[workspaceName]?.team) {
    const { pending_token: _drop, ...rest } = updated.workspaces[workspaceName].team!;
    updated.workspaces[workspaceName].team = rest as typeof team;
    writeSettings(updated);
  }

  return { accepted: true, secret: team.secret };
}
