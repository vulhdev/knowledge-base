import { createHash } from "node:crypto";
import { getTeamByName, listInvites, removeInvite } from "../db/team.js";
import { createWorkspace } from "../db/workspaces.js";
import { getGitHubUsername } from "../team/github.js";
import type Database from "better-sqlite3";

export type JoinRequest = {
  githubToken: string;
  peerPublicKey: string;
  githubUsername?: string;
};

export type JoinResult =
  | { accepted: true; secret: string }
  | { accepted: false; reason: string };

export function deriveJoinTopic(workspaceName: string, hostPublicKey: string): Buffer {
  return createHash("sha256").update(`${hostPublicKey}:${workspaceName}:join`).digest();
}

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

const inFlight = new Set<string>();

export async function handleJoinRequest(
  db: Database.Database,
  workspaceName: string,
  req: JoinRequest,
): Promise<JoinResult> {
  const team = getTeamByName(db, workspaceName);
  if (!team) return { accepted: false, reason: "workspace not found" };

  const ws = createWorkspace(db, workspaceName);
  const pendingInvites = listInvites(db, ws.id);
  if (pendingInvites.length === 0) {
    return { accepted: false, reason: "no pending invites" };
  }

  if (!req.githubToken || req.githubToken.length > 255) {
    return { accepted: false, reason: "invalid github token" };
  }

  let username: string;
  try {
    username = await getGitHubUsername(req.githubToken);
  } catch {
    return { accepted: false, reason: "GitHub token verification failed" };
  }

  if (req.githubUsername !== undefined && req.githubUsername !== username) {
    return { accepted: false, reason: `username mismatch: claimed @${req.githubUsername} but token resolves to @${username}` };
  }

  if (inFlight.has(username)) {
    return { accepted: false, reason: "join already in progress" };
  }
  inFlight.add(username);

  try {
    // Re-read from DB after the async gap — stale invites from before
    // the await cannot be trusted when two connections race for the same invite.
    const freshTeam = getTeamByName(db, workspaceName);
    if (!freshTeam) return { accepted: false, reason: "workspace not found" };

    const freshInvites = listInvites(db, ws.id);
    const invite = freshInvites.find((i) => i.github_username === username);
    if (!invite) {
      return { accepted: false, reason: `@${username} is not invited` };
    }
    if (Date.now() - new Date(invite.invited_at).getTime() > INVITE_TTL_MS) {
      return { accepted: false, reason: `invite for @${username} has expired` };
    }

    const kicked = db
      .prepare("SELECT 1 FROM team_peers WHERE github_username = ? AND is_active = 0")
      .get(username);
    if (kicked) {
      return { accepted: false, reason: `@${username} has been removed from this team` };
    }

    db.prepare(
      "INSERT OR IGNORE INTO team_peers (public_key, display_name, github_username) VALUES (?, ?, ?)",
    ).run(req.peerPublicKey, `@${username}`, username);

    removeInvite(db, ws.id, username);

    return { accepted: true, secret: freshTeam.secret };
  } finally {
    inFlight.delete(username);
  }
}
