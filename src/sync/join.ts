import { createHash } from "node:crypto";
import { getTeamByName, listInvites, removeInvite } from "../db/team.js";
import { getGitHubUsername } from "../team/github.js";
import { HOST_VERSION, parseMajorMinor } from "./version.js";
import type Database from "better-sqlite3";

const HEX64 = /^[0-9a-f]{64}$/;

export type JoinRequest = {
  githubToken: string;
  peerPublicKey: string;
  githubUsername?: string;
  appVersion?: string;
};

export type JoinResult =
  | { accepted: true; secret: string }
  | { accepted: false; reason: string };

export function deriveJoinTopic(workspaceName: string, hostPublicKey: string): Buffer {
  return createHash("sha256").update(`${hostPublicKey}:${workspaceName}:join`).digest();
}

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

// Composite key: workspaceName + ":" + username — prevents a username in one workspace
// from blocking the same username joining a different workspace simultaneously.
const inFlight = new Set<string>();

export async function handleJoinRequest(
  db: Database.Database,
  workspaceName: string,
  req: JoinRequest,
): Promise<JoinResult> {
  if (!req.appVersion) {
    return { accepted: false, reason: "appVersion required — upgrade to latest knowledge-base" };
  }
  if (parseMajorMinor(req.appVersion) !== parseMajorMinor(HOST_VERSION)) {
    return {
      accepted: false,
      reason: `version mismatch: peer is ${parseMajorMinor(req.appVersion)}.x, host requires ${parseMajorMinor(HOST_VERSION)}.x`,
    };
  }

  const team = getTeamByName(db, workspaceName);
  if (!team) return { accepted: false, reason: "workspace not found" };

  // Use the workspace_id from the already-verified team row — no redundant createWorkspace call.
  const workspaceId = team.workspace_id;
  const pendingInvites = listInvites(db, workspaceId);
  if (pendingInvites.length === 0) {
    return { accepted: false, reason: "no pending invites" };
  }

  if (!HEX64.test(req.peerPublicKey)) {
    return { accepted: false, reason: "invalid public key: must be 64 lowercase hex characters" };
  }

  if (!req.githubToken || req.githubToken.length > 255) {
    return { accepted: false, reason: "invalid github token" };
  }

  const noAuthBypass =
    process.env.KB_E2E_NO_GITHUB_AUTH === "1" &&
    req.githubToken === "no-github-auth-token";

  let username: string;
  if (noAuthBypass) {
    if (!req.githubUsername) {
      return { accepted: false, reason: "KB_E2E_NO_GITHUB_AUTH: githubUsername required when bypassing auth" };
    }
    username = req.githubUsername;
  } else {
    try {
      username = await getGitHubUsername(req.githubToken);
    } catch {
      return { accepted: false, reason: "GitHub token verification failed" };
    }
    if (req.githubUsername !== undefined && req.githubUsername !== username) {
      return { accepted: false, reason: `username mismatch: claimed @${req.githubUsername} but token resolves to @${username}` };
    }
  }

  const inFlightKey = `${workspaceName}:${username}`;
  if (inFlight.has(inFlightKey)) {
    return { accepted: false, reason: "join already in progress" };
  }
  inFlight.add(inFlightKey);

  try {
    // Re-read from DB after the async gap — stale invites from before
    // the await cannot be trusted when two connections race for the same invite.
    const freshTeam = getTeamByName(db, workspaceName);
    if (!freshTeam) return { accepted: false, reason: "workspace not found" };

    const freshInvites = listInvites(db, workspaceId);
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

    removeInvite(db, workspaceId, username);

    return { accepted: true, secret: freshTeam.secret };
  } finally {
    inFlight.delete(inFlightKey);
  }
}
