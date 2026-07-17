import type Database from "better-sqlite3";
import type { ContentType, SearchResult } from "../types.js";
import { isModelReady, getEmbedding } from "../embedding/model.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function searchSemantic(
  db: Database.Database,
  query: string,
  workspace?: string,
  type?: ContentType,
  limit = DEFAULT_LIMIT,
): Promise<SearchResult[]> {
  if (!isModelReady()) {
    throw new Error(
      "Semantic search is not available. Run: npx @vulhdev/knowledge-base init",
    );
  }

  const clampedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  try {
    const queryEmbedding = await getEmbedding(query);
    const blob = Buffer.from(queryEmbedding.buffer);

    const conditions: string[] = [];
    const params: (Buffer | string | number)[] = [];

    let sql = `
      SELECT c.id, w.name AS workspace, f.name AS feature, c.type, c.title, c.body,
             c.created_at, c.updated_at, v.distance AS score
      FROM vec_contents v
      JOIN contents c ON v.rowid = c.id
      JOIN features f ON c.feature_id = f.id
      JOIN workspaces w ON f.workspace_id = w.id
      WHERE v.embedding MATCH ? AND k = ?
    `;
    params.push(blob, clampedLimit);

    if (workspace !== undefined) {
      conditions.push("w.name = ?");
      params.push(workspace);
    }
    if (type !== undefined) {
      conditions.push("c.type = ?");
      params.push(type);
    }

    if (conditions.length > 0) {
      sql += ` AND ${conditions.join(" AND ")}`;
    }

    sql += " ORDER BY v.distance";

    return db.prepare(sql).all(...params) as SearchResult[];
  } catch (err) {
    if (err instanceof Error && err.message.includes("npx @vulhdev")) {
      throw err;
    }
    return [];
  }
}
