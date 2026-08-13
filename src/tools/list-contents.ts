import type Database from "better-sqlite3";
import type { Content, ContentType, ListPage } from "../types.js";
import { fetchFeatures } from "./_helpers.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function listContents(
  db: Database.Database,
  workspace: string,
  feature?: string,
  type?: ContentType,
  limit = DEFAULT_LIMIT,
  offset = 0,
): ListPage {
  if (!workspace.trim()) {
    throw new Error("workspace must not be empty");
  }

  const clampedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  const clampedOffset = Math.max(0, offset);

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

  const where = `WHERE ${conditions.join(" AND ")}`;

  const countSql = `
    SELECT COUNT(DISTINCT c.id) AS total
    FROM contents c
    JOIN content_features cf ON cf.content_id = c.id
    JOIN features f ON cf.feature_id = f.id
    JOIN workspaces w ON f.workspace_id = w.id
    ${where}
  `;
  const { total } = db.prepare(countSql).get(...params) as { total: number };

  const dataSql = `
    SELECT DISTINCT c.id, w.name AS workspace, c.type, c.title, c.body, c.created_at, c.updated_at
    FROM contents c
    JOIN content_features cf ON cf.content_id = c.id
    JOIN features f ON cf.feature_id = f.id
    JOIN workspaces w ON f.workspace_id = w.id
    ${where}
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `;
  type RawRow = Omit<Content, "features" | "has_code_refs">;
  const rows = db.prepare(dataSql).all(...params, clampedLimit, clampedOffset) as RawRow[];
  const results = rows.map((row) => ({ ...row, features: fetchFeatures(db, row.id) })) as Content[];

  return {
    results,
    has_more: clampedOffset + clampedLimit < total,
    total,
    offset: clampedOffset,
    limit: clampedLimit,
  };
}
