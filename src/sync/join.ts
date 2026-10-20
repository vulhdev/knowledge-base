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

export function deriveJoinTopic(workspaceName: string, hostPublicKey: string): Buffer {
  return createHash("sha256").update(`${hostPublicKey}:${workspaceName}:join`).digest();
}

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export async function handleJoinRequest(
  db: Database.Database,
  workspaceName: string,
  req: JoinRequest,
): Promise<JoinResult> {
  const settings = loadSettings();
  const team = settings.workspaces?.[workspaceName]?.team;
  if (!team) return { accepted: false, reason: "workspace not found" };

  const pendingInvites = team.pending_invites;
  const pendingUsernames = team.pending_github_usernames ?? [];

  if ((pendingInvites?.length ?? 0) === 0 && pendingUsernames.length === 0) {
    return { accepted: false, reason: "no pending invites" };
  }

  let username: string;
  try {
    username = await getGitHubUsername(req.githubToken);
  } catch {
    return { accepted: false, reason: "GitHub token verification failed" };
  }

  if (pendingInvites !== undefined) {
    const invite = pendingInvites.find((i) => i.username === username);
    if (!invite) return { accepted: false, reason: `@${username} is not invited` };
    if (Date.now() - new Date(invite.invited_at).getTime() > INVITE_TTL_MS) {
      return { accepted: false, reason: `invite for @${username} has expired` };
    }
  } else if (!pendingUsernames.includes(username)) {
    return { accepted: false, reason: `@${username} is not invited` };
  }

  db.prepare(
    "INSERT OR IGNORE INTO team_peers (public_key, display_name, github_username) VALUES (?, ?, ?)",
  ).run(req.peerPublicKey, `@${username}`, username);

  const updated = loadSettings();
  if (updated.workspaces?.[workspaceName]?.team) {
    const t = updated.workspaces[workspaceName].team!;
    t.pending_github_usernames = (t.pending_github_usernames ?? []).filter((u) => u !== username);
    if (t.pending_invites) {
      t.pending_invites = t.pending_invites.filter((i) => i.username !== username);
    }
    writeSettings(updated);
  }

  return { accepted: true, secret: team.secret };
}
