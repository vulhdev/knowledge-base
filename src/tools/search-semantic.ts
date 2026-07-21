import type Database from "better-sqlite3";
import type { ContentType, SearchResult, SearchPage } from "../types.js";
import { isModelReady, getEmbedding } from "../embedding/model.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
// Standard RRF constant — dampens the impact of rank differences at the top
const RRF_K = 60;
const MS_PER_DAY = 86_400_000;
// Recency boost: max +20% for a doc updated today, decaying with a 30-day half-life
const RECENCY_WEIGHT = 0.2;
const RECENCY_HALF_LIFE_DAYS = 30;

function recencyFactor(updatedAt: string): number {
  const ageDays = (Date.now() - new Date(updatedAt).getTime()) / MS_PER_DAY;
  return 1 / (1 + ageDays / RECENCY_HALF_LIFE_DAYS);
}

type RawRow = Omit<SearchResult, "has_code_refs" | "score">;

export async function searchSemantic(
  db: Database.Database,
  query: string,
  workspace?: string,
  type?: ContentType,
  limit = DEFAULT_LIMIT,
  offset = 0,
): Promise<SearchPage> {
  if (!isModelReady()) {
    throw new Error(
      "Semantic search is not available. Run: npx @vulhdev/knowledge-base init",
    );
  }

  const clampedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  const clampedOffset = Math.max(0, offset);
  // Pool must be large enough to cover offset + limit so pagination is lossless
  const internalK = Math.min((clampedOffset + clampedLimit) * 5, 200);

  try {
    const queryEmbedding = await getEmbedding(query);
    const blob = Buffer.from(queryEmbedding.buffer);

    const filterConditions: string[] = [];
    const vecParams: (Buffer | string | number)[] = [blob, internalK];
    const ftsFilterParams: (string | number)[] = [];

    if (workspace !== undefined) {
      filterConditions.push("w.name = ?");
      vecParams.push(workspace);
      ftsFilterParams.push(workspace);
    }
    if (type !== undefined) {
      filterConditions.push("c.type = ?");
      vecParams.push(type);
      ftsFilterParams.push(type);
    }

    // --- Vector search (ANN) ---
    let vecSql = `
      SELECT c.id, w.name AS workspace, f.name AS feature, c.type, c.title, c.body,
             c.created_at, c.updated_at
      FROM vec_contents v
      JOIN contents c ON v.rowid = c.id
      JOIN features f ON c.feature_id = f.id
      JOIN workspaces w ON f.workspace_id = w.id
      WHERE v.embedding MATCH ? AND k = ?
    `;
    if (filterConditions.length > 0) {
      vecSql += ` AND ${filterConditions.join(" AND ")}`;
    }
    vecSql += " ORDER BY v.distance";

    const vecRows = db.prepare(vecSql).all(...vecParams) as RawRow[];

    // --- BM25 full-text search ---
    const ftsIds = runFtsSearch(db, query, filterConditions, ftsFilterParams, internalK);

    // --- Reciprocal Rank Fusion ---
    const vecRankMap = new Map(vecRows.map((r, i) => [r.id, i + 1]));
    const ftsRankMap = new Map(ftsIds.map((id, i) => [id, i + 1]));

    // Start with vec candidates; supplement with FTS-only hits not in the ANN pool
    const contentMap = new Map<number, RawRow>(vecRows.map(r => [r.id, r]));
    const vecIdSet = new Set(vecRows.map(r => r.id));
    const ftsOnlyIds = ftsIds.filter(id => !vecIdSet.has(id));

    if (ftsOnlyIds.length > 0) {
      const placeholders = ftsOnlyIds.map(() => "?").join(",");
      const extraRows = db.prepare(`
        SELECT c.id, w.name AS workspace, f.name AS feature, c.type, c.title, c.body,
               c.created_at, c.updated_at
        FROM contents c
        JOIN features f ON c.feature_id = f.id
        JOIN workspaces w ON f.workspace_id = w.id
        WHERE c.id IN (${placeholders})
      `).all(...ftsOnlyIds) as RawRow[];

      for (const row of extraRows) {
        contentMap.set(row.id, row);
      }
    }

    const allIds = new Set([...vecRankMap.keys(), ...ftsRankMap.keys()]);
    const scored: SearchResult[] = [];

    for (const id of allIds) {
      const content = contentMap.get(id);
      if (!content) continue;

      const vecRank = vecRankMap.get(id);
      const ftsRank = ftsRankMap.get(id);
      const rrfScore =
        (vecRank !== undefined ? 1 / (RRF_K + vecRank) : 0) +
        (ftsRank !== undefined ? 1 / (RRF_K + ftsRank) : 0);

      const boostedScore = rrfScore * (1 + RECENCY_WEIGHT * recencyFactor(content.updated_at));
      scored.push({ ...content, has_code_refs: false, score: boostedScore });
    }

    scored.sort((a, b) => b.score - a.score);
    const sliced = scored.slice(clampedOffset, clampedOffset + clampedLimit);
    return {
      results: sliced,
      has_more: scored.length > clampedOffset + clampedLimit,
      total_in_pool: scored.length,
      offset: clampedOffset,
      limit: clampedLimit,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("npx @vulhdev")) {
      throw err;
    }
    return { results: [], has_more: false, total_in_pool: 0, offset: clampedOffset ?? 0, limit: clampedLimit ?? DEFAULT_LIMIT };
  }
}

function runFtsSearch(
  db: Database.Database,
  query: string,
  conditions: string[],
  filterParams: (string | number)[],
  limit: number,
): number[] {
  const tokens = query
    .split(/\s+/)
    .map(w => w.replace(/[*"^():]/g, "").trim())
    .filter(w => w.length > 1);

  if (tokens.length === 0) return [];

  const ftsQuery = tokens.join(" OR ");

  let sql = `
    SELECT c.id
    FROM contents_fts fts
    JOIN contents c ON fts.rowid = c.id
    JOIN features f ON c.feature_id = f.id
    JOIN workspaces w ON f.workspace_id = w.id
    WHERE contents_fts MATCH ?
  `;
  if (conditions.length > 0) {
    sql += ` AND ${conditions.join(" AND ")}`;
  }
  sql += ` ORDER BY bm25(contents_fts, 5.0, 1.0) LIMIT ${limit}`;

  try {
    return (db.prepare(sql).all(ftsQuery, ...filterParams) as { id: number }[]).map(r => r.id);
  } catch {
    return [];
  }
}
