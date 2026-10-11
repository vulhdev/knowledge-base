import type Database from "better-sqlite3";

export type PushItem = {
  feature: string;
  type: string;
  title?: string;
  body: string;
};

export function fetchWorkspaceItems(db: Database.Database, workspace: string): PushItem[] {
  type Row = { type: string; title: string | null; body: string; feature: string };
  const rows = db
    .prepare(
      `SELECT c.type, c.title, c.body, f.name AS feature
       FROM contents c
       JOIN content_features cf ON cf.content_id = c.id
       JOIN features f ON f.id = cf.feature_id
       JOIN workspaces w ON w.id = f.workspace_id
       WHERE w.name = ? AND c.is_latest = 1
       GROUP BY c.id
       ORDER BY c.id`
    )
    .all(workspace) as Row[];

  return rows.map((r) => ({
    feature: r.feature,
    type: r.type,
    ...(r.title ? { title: r.title } : {}),
    body: r.body,
  }));
}
