import { randomBytes } from "node:crypto";
import { loadSettings, writeSettings } from "../config.js";

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;

export function generatePendingToken(): string {
  return randomBytes(16).toString("hex");
}

export function buildInviteKey(hostPublicKey: string, pendingToken: string): string {
  return `${hostPublicKey}:${pendingToken}`;
}

export function generateInvite(workspaceName: string): string {
  const settings = loadSettings();
  const team = settings.workspaces?.[workspaceName]?.team;
  if (!team) throw new Error(`No team config found for workspace "${workspaceName}"`);
  if (team.role !== "host") throw new Error("Only the host can generate invite keys");

  const token = generatePendingToken();
  const updated = loadSettings();
  updated.workspaces ??= {};
  updated.workspaces[workspaceName] ??= {};
  updated.workspaces[workspaceName].team = { ...team, pending_token: token };
  writeSettings(updated);

  return buildInviteKey(team.noise_keypair.publicKey, token);
}

export function parseInviteKey(key: string): { hostPublicKey: string; pendingToken: string } {
  const sep = key.indexOf(":");
  if (sep === -1) throw new Error("Invalid invite key: missing ':'");
  const hostPublicKey = key.slice(0, sep);
  const pendingToken = key.slice(sep + 1);
  if (!HEX64.test(hostPublicKey)) throw new Error("Invalid invite key: hostPublicKey must be 64 hex chars");
  if (!HEX32.test(pendingToken)) throw new Error("Invalid invite key: pendingToken must be 32 hex chars");
  return { hostPublicKey, pendingToken };
}
