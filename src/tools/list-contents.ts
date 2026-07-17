import type Database from "better-sqlite3";
import type { Content, ContentType } from "../types.js";

export function listContents(
  db: Database.Database,
  workspace: string,
  feature?: string,
  type?: ContentType,
): Content[] {
  if (!workspace.trim()) {
    throw new Error("workspace must not be empty");
  }

  const conditions: string[] = ["w.name = ?"];
  const params: (string | number | bigint | null)[] = [workspace];

  if (feature !== undefined) {
    conditions.push("f.name = ?");
    params.push(feature);
  }
  if (type !== undefined) {
    conditions.push("c.type = ?");
    params.push(type);
  } else {
    conditions.push("c.type != 'digest'");
  }

  const sql = `
    SELECT c.id, w.name AS workspace, f.name AS feature, c.type, c.title, c.body, c.created_at, c.updated_at
    FROM contents c
    JOIN features f ON c.feature_id = f.id
    JOIN workspaces w ON f.workspace_id = w.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY c.created_at DESC
  `;

  return db.prepare(sql).all(...params) as Content[];
}
