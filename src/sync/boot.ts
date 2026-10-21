import type Database from "better-sqlite3";
import { listTeamWorkspaces, getTeamByName } from "../db/team.js";
import { startSync, type SyncHandle } from "./index.js";
import { readWorkspaceFromClaudeMd } from "./claude-md.js";

export function startSyncIfConfigured(db: Database.Database): SyncHandle | null {
  const teamWorkspaces = listTeamWorkspaces(db);
  if (teamWorkspaces.length === 0) return null;

  for (const ws of teamWorkspaces) {
    return startSync(db, ws.name);
  }
  return null;
}

export function startSyncFromClaudeMd(db: Database.Database, cwd?: string): void {
  const workspaceName = readWorkspaceFromClaudeMd(cwd);
  if (!workspaceName) return;

  if (!getTeamByName(db, workspaceName)) return;

  try {
    const handle = startSync(db, workspaceName);
    if (handle) {
      process.stderr.write(`[knowledge-base] sync started for workspace "${workspaceName}"\n`);
    }
  } catch {
    // never block MCP startup
  }
}
