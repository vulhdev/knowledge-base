import { randomBytes, createHash } from "node:crypto";
import type Database from "better-sqlite3";

const TTL_DAYS = 30;

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function createSession(db: Database.Database, github_login: string): string {
  const raw = randomBytes(32).toString("hex");
  const token_hash = sha256(raw);
  const expires_at = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  db.prepare(
    "INSERT INTO sessions (github_login, token_hash, expires_at) VALUES (?, ?, ?)"
  ).run(github_login, token_hash, expires_at);

  return raw;
}

export function validateSession(
  db: Database.Database,
  raw: string | undefined
): { github_login: string } | null {
  if (!raw) return null;

  const token_hash = sha256(raw);
  const row = db
    .prepare(
      "SELECT github_login FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')"
    )
    .get(token_hash) as { github_login: string } | undefined;

  return row ? { github_login: row.github_login } : null;
}
