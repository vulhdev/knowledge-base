import type { DatabaseSync } from "node:sqlite";
import type { ContentType, SearchResult } from "../types.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export function searchContent(
  db: DatabaseSync,
  query: string,
  workspace?: string,
  type?: ContentType,
  limit = DEFAULT_LIMIT,
): SearchResult[] {
  const clampedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  const conditions: string[] = ["contents_fts MATCH ?"];
  const params: (string | number | bigint | null)[] = [query];

  if (workspace !== undefined) {
    conditions.push("w.name = ?");
    params.push(workspace);
  }
  if (type !== undefined) {
    conditions.push("c.type = ?");
    params.push(type);
  }

  const sql = `
    SELECT c.id, w.name AS workspace, f.name AS feature, c.type, c.body,
           c.created_at, c.updated_at, bm25(contents_fts) AS score
    FROM contents_fts
    JOIN contents c ON contents_fts.rowid = c.id
    JOIN features f ON c.feature_id = f.id
    JOIN workspaces w ON f.workspace_id = w.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY bm25(contents_fts)
    LIMIT ?
  `;
  params.push(clampedLimit);

  try {
    return db.prepare(sql).all(...params) as SearchResult[];
  } catch {
    return [];
  }
}
