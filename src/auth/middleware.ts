import { AsyncLocalStorage } from "node:async_hooks";
import type Database from "better-sqlite3";
import { isMember } from "../db/members.js";

export type AuthContext = {
  github_login: string;
};

export const authCtx = new AsyncLocalStorage<AuthContext>();

export function assertAccess(
  db: Database.Database,
  workspace: string,
  opts: { serverMode?: boolean } = {}
): void {
  // In local mode (serverMode=false), ACL is bypassed entirely.
  if (opts.serverMode === false) return;

  const ctx = authCtx.getStore();
  if (!ctx) {
    throw new Error("Unauthenticated: no active session");
  }

  if (!isMember(db, ctx.github_login, workspace)) {
    throw new Error(`Forbidden: ${ctx.github_login} is not a member of workspace "${workspace}"`);
  }
}
