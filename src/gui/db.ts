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

export type WorkspaceSummary = {
  id: number;
  name: string;
  feature_count: number;
  last_updated: string | null;
};

export function listWorkspaceSummaries(db: Database.Database): WorkspaceSummary[] {
  return db
    .prepare(
      `SELECT w.id, w.name,
         COUNT(DISTINCT f.id)  AS feature_count,
         MAX(c.updated_at)     AS last_updated
       FROM workspaces w
       LEFT JOIN features f ON f.workspace_id = w.id
       LEFT JOIN contents c ON c.feature_id   = f.id
       GROUP BY w.id, w.name
       ORDER BY w.name ASC`,
    )
    .all() as WorkspaceSummary[];
}
