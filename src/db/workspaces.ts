import type { DatabaseSync } from "node:sqlite";

export type Workspace = { id: number; name: string };

export function listWorkspaces(db: DatabaseSync): Workspace[] {
  return db
    .prepare("SELECT id, name FROM workspaces ORDER BY name ASC")
    .all() as Workspace[];
}

export function createWorkspace(db: DatabaseSync, name: string): Workspace {
  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(name);
  return db
    .prepare("SELECT id, name FROM workspaces WHERE name = ?")
    .get(name) as Workspace;
}
