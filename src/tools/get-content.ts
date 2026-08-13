import type Database from "better-sqlite3";
import type { Content } from "../types.js";
import { fetchFeatures } from "./_helpers.js";

export function getContent(db: Database.Database, id: number): Content {
  type RawRow = Omit<Content, "features" | "has_code_refs"> & { has_code_refs: number };
  const row = db
    .prepare(
      `SELECT c.id, w.name AS workspace, c.type, c.title, c.body, c.created_at, c.updated_at,
              EXISTS(SELECT 1 FROM code_refs WHERE content_id = c.id) AS has_code_refs
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

  return { ...row, features: fetchFeatures(db, id), has_code_refs: row.has_code_refs === 1 };
}
