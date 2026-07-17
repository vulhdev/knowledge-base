import type Database from "better-sqlite3";

export type Workspace = { id: number; name: string };

export function listWorkspaces(db: Database.Database): Workspace[] {
  return db
    .prepare("SELECT id, name FROM workspaces ORDER BY name ASC")
    .all() as Workspace[];
}

export function createWorkspace(db: Database.Database, name: string): Workspace {
  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(name);
  return db
    .prepare("SELECT id, name FROM workspaces WHERE name = ?")
    .get(name) as Workspace;
}
