import type Database from "better-sqlite3";

export type Feature = { id: number; name: string };

export function listFeatures(db: Database.Database, workspace: string): Feature[] {
  return db
    .prepare(
      `SELECT f.id, f.name
       FROM features f
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE w.name = ?
       ORDER BY f.name ASC`,
    )
    .all(workspace) as Feature[];
}
