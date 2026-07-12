import type { DatabaseSync } from "node:sqlite";
import type { Content, ContentType } from "../types.js";

const VALID_TYPES: readonly ContentType[] = ["idea", "spec", "plan"];

export function updateContent(
  db: DatabaseSync,
  id: number,
  body: string,
  type?: ContentType,
): Content {
  if (!body.trim()) {
    throw new Error("body must not be empty");
  }
  if (type !== undefined && !VALID_TYPES.includes(type)) {
    throw new Error(`type must be one of: ${VALID_TYPES.join(", ")}`);
  }

  const { changes } = db
    .prepare(
      `UPDATE contents SET body = ?, type = COALESCE(?, type), updated_at = datetime('now') WHERE id = ?`,
    )
    .run(body, type ?? null, id);

  if (changes === 0) {
    throw new Error(`Content not found: id=${id}`);
  }

  const row = db
    .prepare(
      `SELECT c.id, w.name AS workspace, f.name AS feature, c.type, c.body, c.created_at, c.updated_at
       FROM contents c
       JOIN features f ON c.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?`,
    )
    .get(id) as Content;

  return row;
}
