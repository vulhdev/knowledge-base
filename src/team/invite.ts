import { randomBytes } from "node:crypto";

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;

export function generatePendingToken(): string {
  return randomBytes(16).toString("hex");
}

export function buildInviteKey(hostPublicKey: string, pendingToken: string): string {
  return `${hostPublicKey}:${pendingToken}`;
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
