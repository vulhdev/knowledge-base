import type Database from "better-sqlite3";
import type { Content } from "../types.js";
import { fetchFeatures } from "./_helpers.js";

export function deleteContent(db: Database.Database, id: number): Content {
  type RawRow = Omit<Content, "features" | "has_code_refs">;
  const row = db
    .prepare(
      `SELECT c.id, w.name AS workspace, c.type, c.body, c.title, c.created_at, c.updated_at
       FROM contents c
       JOIN content_features cf ON cf.content_id = c.id
       JOIN features f ON cf.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?
       LIMIT 1`,
    )
    .get(id) as RawRow | undefined;

  if (!row) {
    throw new Error(`Content not found: id=${id}`);
  }

  const features = fetchFeatures(db, id);
  db.prepare(`DELETE FROM contents WHERE id = ?`).run(id);

  return { ...row, features, has_code_refs: false };
}
