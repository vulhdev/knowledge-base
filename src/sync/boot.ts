import type Database from "better-sqlite3";
import { loadSettings } from "../config.js";
import { startSync, type SyncHandle } from "./index.js";
import { readWorkspaceFromClaudeMd } from "./claude-md.js";

export function startSyncIfConfigured(db: Database.Database): SyncHandle | null {
  const settings = loadSettings();
  const workspaces = settings.workspaces;
  if (!workspaces) return null;

  for (const [workspaceName, wsConfig] of Object.entries(workspaces)) {
    if (wsConfig.team) {
      return startSync(db, workspaceName);
    }
  }
  return null;
}

export function startSyncFromClaudeMd(db: Database.Database, cwd?: string): void {
  const workspaceName = readWorkspaceFromClaudeMd(cwd);
  if (!workspaceName) return;

  const settings = loadSettings();
  if (!settings.workspaces?.[workspaceName]?.team) return;

  try {
    const handle = startSync(db, workspaceName);
    if (handle) {
      process.stderr.write(`[knowledge-base] sync started for workspace "${workspaceName}"\n`);
    }
  } catch {
    // never block MCP startup
  }
}
