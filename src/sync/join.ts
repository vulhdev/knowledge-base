import { createHash } from "node:crypto";
import { loadSettings, writeSettings } from "../config.js";
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
  const settings = loadSettings();
  const team = settings.workspaces?.[workspaceName]?.team;
  if (!team) return { accepted: false, reason: "workspace not found" };

  const pendingInvites = team.pending_invites;
  const pendingUsernames = team.pending_github_usernames ?? [];

  if ((pendingInvites?.length ?? 0) === 0 && pendingUsernames.length === 0) {
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
    // Re-read settings after the async gap — stale pendingInvites from before
    // the await cannot be trusted when two connections race for the same invite.
    const freshSettings = loadSettings();
    const freshTeam = freshSettings.workspaces?.[workspaceName]?.team;
    if (!freshTeam) return { accepted: false, reason: "workspace not found" };

    const freshPendingInvites = freshTeam.pending_invites;
    const freshPendingUsernames = freshTeam.pending_github_usernames ?? [];

    let foundViaInvite = false;
    if (freshPendingInvites !== undefined && freshPendingInvites.length > 0) {
      const invite = freshPendingInvites.find((i) => i.username === username);
      if (invite) {
        if (Date.now() - new Date(invite.invited_at).getTime() > INVITE_TTL_MS) {
          return { accepted: false, reason: `invite for @${username} has expired` };
        }
        foundViaInvite = true;
      }
    }
    if (!foundViaInvite && !freshPendingUsernames.includes(username)) {
      return { accepted: false, reason: `@${username} is not invited` };
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

    const updated = loadSettings();
    if (updated.workspaces?.[workspaceName]?.team) {
      const t = updated.workspaces[workspaceName].team!;
      t.pending_github_usernames = (t.pending_github_usernames ?? []).filter((u) => u !== username);
      if (t.pending_invites) {
        t.pending_invites = t.pending_invites.filter((i) => i.username !== username);
      }
      writeSettings(updated);
    }

    return { accepted: true, secret: freshTeam.secret };
  } finally {
    inFlight.delete(username);
  }
}
