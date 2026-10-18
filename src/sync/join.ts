import { createHash } from "node:crypto";
import { loadSettings, writeSettings } from "../config.js";
import { getGitHubUsername } from "../team/github.js";
import type Database from "better-sqlite3";

export type JoinRequest = {
  githubToken: string;
  peerPublicKey: string;
};

export type JoinResult =
  | { accepted: true; secret: string }
  | { accepted: false; reason: string };

export function deriveJoinTopic(workspaceName: string): Buffer {
  return createHash("sha256").update(`${workspaceName}:join`).digest();
}

export async function handleJoinRequest(
  db: Database.Database,
  workspaceName: string,
  req: JoinRequest,
): Promise<JoinResult> {
  const settings = loadSettings();
  const team = settings.workspaces?.[workspaceName]?.team;
  if (!team) return { accepted: false, reason: "workspace not found" };

  const pending = team.pending_github_usernames ?? [];
  if (pending.length === 0) return { accepted: false, reason: "no pending invites" };

  let username: string;
  try {
    username = await getGitHubUsername(req.githubToken);
  } catch {
    return { accepted: false, reason: "GitHub token verification failed" };
  }

  if (!pending.includes(username)) {
    return { accepted: false, reason: `@${username} is not invited` };
  }

  db.prepare(
    "INSERT OR IGNORE INTO team_peers (public_key, display_name, github_username) VALUES (?, ?, ?)",
  ).run(req.peerPublicKey, `@${username}`, username);

  const updated = loadSettings();
  if (updated.workspaces?.[workspaceName]?.team) {
    const remaining = (updated.workspaces[workspaceName].team!.pending_github_usernames ?? [])
      .filter((u) => u !== username);
    updated.workspaces[workspaceName].team!.pending_github_usernames = remaining;
    writeSettings(updated);
  }

  return { accepted: true, secret: team.secret };
}
