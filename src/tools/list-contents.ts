import type Database from "better-sqlite3";
import type { Content, ContentType, ListPage } from "../types.js";
import { fetchFeaturesBatch } from "./_helpers.js";

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

  let dataSql: string;
  let dataArgs: (string | number | bigint | null)[];
  if (feature !== undefined) {
    dataSql = `
    SELECT DISTINCT c.id, w.name AS workspace, c.type, c.title, c.body, c.root_id, c.version_number,
           c.created_at, c.updated_at
    FROM contents c
    JOIN content_features cf ON cf.content_id = c.id
    JOIN features f ON cf.feature_id = f.id
    JOIN workspaces w ON f.workspace_id = w.id
    ${where}
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ? OFFSET ?
  `;
    dataArgs = [...params, clampedLimit, clampedOffset];
  } else {
    // No feature filter: walk contents in index order and test workspace membership per row,
    // so the default and type-filtered listings avoid a temp sort over the whole workspace.
    dataSql = `
    SELECT c.id, ? AS workspace, c.type, c.title, c.body, c.root_id, c.version_number,
           c.created_at, c.updated_at
    FROM contents c
    WHERE ${type !== undefined ? "c.type = ?" : "c.type != 'digest'"}
      AND EXISTS (
        SELECT 1
        FROM content_features cf
        JOIN features f ON cf.feature_id = f.id
        JOIN workspaces w ON f.workspace_id = w.id
        WHERE cf.content_id = c.id AND w.name = ?
      )
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ? OFFSET ?
  `;
    dataArgs = [workspace, ...(type !== undefined ? [type] : []), workspace, clampedLimit, clampedOffset];
  }
  type RawRow = Omit<Content, "features" | "has_code_refs">;
  const rows = db.prepare(dataSql).all(...dataArgs) as RawRow[];
  const featureMap = fetchFeaturesBatch(db, rows.map((r) => r.id));
  const results = rows.map((row) => ({ ...row, features: featureMap.get(row.id) ?? [], has_code_refs: false })) as Content[];

  return {
    results,
    has_more: clampedOffset + clampedLimit < total,
    total,
    offset: clampedOffset,
    limit: clampedLimit,
  };
}
