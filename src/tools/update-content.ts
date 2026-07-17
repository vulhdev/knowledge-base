import type { DatabaseSync } from "node:sqlite";
import type { Content, ContentType } from "../types.js";

export function updateContent(
  db: DatabaseSync,
  id: number,
  body: string,
  type?: ContentType,
  title?: string,
): Content {
  if (!body.trim()) {
    throw new Error("body must not be empty");
  }

  const { changes } = db
    .prepare(
      `UPDATE contents
       SET body = ?, type = COALESCE(?, type), title = COALESCE(?, title), updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(body, type ?? null, title ?? null, id);

  if (changes === 0) {
    throw new Error(`Content not found: id=${id}`);
  }

  const row = db
    .prepare(
      `SELECT c.id, w.name AS workspace, f.name AS feature, c.type, c.title, c.body, c.created_at, c.updated_at
       FROM contents c
       JOIN features f ON c.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?`,
    )
    .get(id) as Content;

  return row;
}
