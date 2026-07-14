import type { DatabaseSync } from "node:sqlite";
import type { Content } from "../types.js";

export function getContent(db: DatabaseSync, id: number): Content {
  const row = db
    .prepare(
      `SELECT c.id, w.name AS workspace, f.name AS feature, c.type, c.title, c.body, c.created_at, c.updated_at
       FROM contents c
       JOIN features f ON c.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?`,
    )
    .get(id) as Content | undefined;

  if (!row) {
    throw new Error(`Content not found: id=${id}`);
  }

  return row;
}
