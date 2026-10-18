import type Database from "better-sqlite3";
import { loadSettings } from "../config.js";
import { startSync, type SyncHandle } from "./index.js";

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
