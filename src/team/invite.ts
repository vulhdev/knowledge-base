import { loadSettings, writeSettings } from "../config.js";

const HEX64 = /^[0-9a-f]{64}$/;
const GITHUB_USERNAME = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

export function buildInviteCode(hostPublicKey: string, workspaceName: string): string {
  return `${hostPublicKey}:${workspaceName}`;
}

export function parseInviteCode(code: string): { hostPublicKey: string; workspaceName: string } {
  const sep = code.indexOf(":");
  if (sep === -1) throw new Error("Invalid invite code: missing ':'");
  const hostPublicKey = code.slice(0, sep);
  const workspaceName = code.slice(sep + 1);
  if (!HEX64.test(hostPublicKey)) throw new Error("Invalid invite code: hostPublicKey must be 64 hex chars");
  if (!workspaceName) throw new Error("Invalid invite code: workspaceName is empty");
  return { hostPublicKey, workspaceName };
}

export function normalizeGithubUsername(raw: string): string {
  const username = raw.startsWith("@") ? raw.slice(1) : raw;
  if (!GITHUB_USERNAME.test(username)) throw new Error(`Invalid GitHub username: "${username}"`);
  return username;
}

export function generateInvite(workspaceName: string, githubUsername: string): string {
  const settings = loadSettings();
  const team = settings.workspaces?.[workspaceName]?.team;
  if (!team) throw new Error(`No team config found for workspace "${workspaceName}"`);
  if (team.role !== "host") throw new Error("Only the host can generate invite codes");

  const updated = loadSettings();
  updated.workspaces ??= {};
  updated.workspaces[workspaceName] ??= {};
  const existingUsernames = updated.workspaces[workspaceName].team?.pending_github_usernames ?? [];
  const existingInvites = updated.workspaces[workspaceName].team?.pending_invites ?? [];
  updated.workspaces[workspaceName].team = {
    ...team,
    pending_github_usernames: [...existingUsernames, githubUsername],
    pending_invites: [
      ...existingInvites,
      { username: githubUsername, invited_at: new Date().toISOString() },
    ],
  };
  writeSettings(updated);

  return buildInviteCode(team.noise_keypair.publicKey, workspaceName);
}
