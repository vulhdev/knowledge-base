import type Database from "better-sqlite3";
import type { ContentType, SearchResult, SearchPage, MatchedSection } from "../types.js";
import { isModelReady, getEmbedding } from "../embedding/model.js";
import { fetchFeaturesBatch } from "./_helpers.js";
import { buildFtsQuery } from "../text/cjk-bigram.js";

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

type RawRow = Omit<SearchResult, "features" | "has_code_refs" | "score" | "matched_sections"> & { has_code_refs: number };

// Section ANN pool: ten sections per doc slot, capped well below the vec0 k limit (tunable)
const SECTION_K_FACTOR = 10;
const SECTION_K_MAX = 2000;
// A doc hit by several sections gets a small distance bonus, capped
const SECTION_HIT_BONUS = 0.01;
const SECTION_BONUS_CAP = 3;
const MAX_MATCHED_SECTIONS = 3;

const CONTENT_COLUMNS = `c.id, w.name AS workspace, c.type, c.title, c.body,
               c.created_at, c.updated_at,
               EXISTS(SELECT 1 FROM code_refs WHERE content_id = c.id) AS has_code_refs`;

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
    const filterParams: (string | number)[] = [];

    if (workspace !== undefined) {
      filterConditions.push("w.name = ?");
      filterParams.push(workspace);
    }
    if (type !== undefined) {
      filterConditions.push("c.type = ?");
      filterParams.push(type);
    }
    const filterSql = filterConditions.length > 0 ? ` AND ${filterConditions.join(" AND ")}` : "";
    const joins = `
      JOIN content_features cf ON cf.content_id = c.id
      JOIN features f ON cf.feature_id = f.id
      JOIN workspaces w ON f.workspace_id = w.id`;

    // --- Vector search (ANN) over doc vectors ---
    const vecRows = db.prepare(`
      SELECT DISTINCT ${CONTENT_COLUMNS}, v.distance AS distance
      FROM vec_contents v
      JOIN contents c ON v.rowid = c.id ${joins}
      WHERE v.embedding MATCH ? AND k = ?${filterSql}
      ORDER BY v.distance
    `).all(blob, internalK, ...filterParams) as (RawRow & { distance: number })[];

    // --- Vector search (ANN) over section vectors, folded back onto their doc ---
    const sectionK = Math.min(internalK * SECTION_K_FACTOR, SECTION_K_MAX);
    const sectionRows = db.prepare(`
      SELECT DISTINCT cc.id AS chunk_id, cc.content_id AS id, v.distance AS distance
      FROM vec_chunks v
      JOIN content_chunks cc ON cc.id = v.rowid
      JOIN contents c ON c.id = cc.content_id ${joins}
      WHERE v.embedding MATCH ? AND k = ?${filterSql}
      ORDER BY v.distance
    `).all(blob, sectionK, ...filterParams) as { chunk_id: number; id: number; distance: number }[];

    const docDistance = new Map<number, number>();
    for (const r of vecRows) docDistance.set(r.id, r.distance);
    const sectionBest = new Map<number, { distance: number; hits: number }>();
    for (const r of sectionRows) {
      const cur = sectionBest.get(r.id);
      if (!cur) sectionBest.set(r.id, { distance: r.distance, hits: 1 });
      else sectionBest.set(r.id, { distance: Math.min(cur.distance, r.distance), hits: cur.hits + 1 });
    }
    const combined: [number, number][] = [];
    for (const id of new Set([...docDistance.keys(), ...sectionBest.keys()])) {
      const sec = sectionBest.get(id);
      const base = Math.min(docDistance.get(id) ?? Infinity, sec?.distance ?? Infinity);
      const bonus = sec ? SECTION_HIT_BONUS * Math.min(sec.hits - 1, SECTION_BONUS_CAP) : 0;
      combined.push([id, base - bonus]);
    }
    combined.sort((a, b) => a[1] - b[1]);
    const vecIds = combined.slice(0, internalK).map(([id]) => id);

    // --- BM25 full-text search: docs (contents_fts) and SOT pointers (sot_chunks_fts) ---
    const ftsIds = runFtsSearch(db, query, filterConditions, filterParams, internalK);
    const sotFtsIds = runSotFtsSearch(db, query, filterConditions, filterParams, internalK);

    // --- Reciprocal Rank Fusion ---
    const rankLists = [vecIds, ftsIds, sotFtsIds].map((ids) => new Map(ids.map((id, i) => [id, i + 1])));

    const contentMap = new Map<number, RawRow>(vecRows.map(({ distance: _d, ...r }) => [r.id, r]));
    const missing = [...new Set([...vecIds, ...ftsIds, ...sotFtsIds])].filter((id) => !contentMap.has(id));

    if (missing.length > 0) {
      const placeholders = missing.map(() => "?").join(",");
      const extraRows = db.prepare(`
        SELECT DISTINCT ${CONTENT_COLUMNS}
        FROM contents c ${joins}
        WHERE c.id IN (${placeholders})
      `).all(...missing) as RawRow[];

      for (const row of extraRows) {
        contentMap.set(row.id, row);
      }
    }

    const allIds = new Set(rankLists.flatMap((m) => [...m.keys()]));
    const scored: Omit<SearchResult, "features">[] = [];

    for (const id of allIds) {
      const content = contentMap.get(id);
      if (!content) continue;

      let rrfScore = 0;
      for (const ranks of rankLists) {
        const rank = ranks.get(id);
        if (rank !== undefined) rrfScore += 1 / (RRF_K + rank);
      }

      const boostedScore = rrfScore * (1 + RECENCY_WEIGHT * recencyFactor(content.updated_at));
      scored.push({ ...content, has_code_refs: content.has_code_refs === 1, score: boostedScore });
    }

    scored.sort((a, b) => b.score - a.score);
    const sliced = scored.slice(clampedOffset, clampedOffset + clampedLimit);
    // Features and sections are looked up for the returned page only, one query each
    const featureMap = fetchFeaturesBatch(db, sliced.map((r) => r.id));
    const sectionMap = matchedSections(db, query, blob, sliced);
    return {
      results: sliced.map(({ score, ...rest }) => ({
        ...rest,
        features: featureMap.get(rest.id) ?? [],
        score,
        ...(sectionMap.has(rest.id) ? { matched_sections: sectionMap.get(rest.id) } : {}),
      })),
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

type SectionRow = {
  id: number;
  content_id: number;
  kind: string;
  chunk_key: string;
  heading_path: string;
  start_char: number | null;
  end_char: number | null;
  start_line: number;
  end_line: number;
  source_path: string | null;
  source_commit: string | null;
  d: number | null;
};

/** Query terms as literal strings (CJK runs and Latin words) for matching inside a section's text. */
function queryTerms(query: string): string[] {
  return buildFtsQuery(query).tokens.map((t) => t.slice(1, -1)).map((t) =>
    t.includes(" ") ? t.split(" ").map((b, i) => (i === 0 ? b : b.slice(-1))).join("") : t,
  ).map((t) => t.toLowerCase());
}

/**
 * Up to three sections per returned doc, ordered by an internal RRF of vector distance to the query
 * and literal term matches (doc: body slice; SOT: sot_chunks_fts restricted to the page's pointers).
 */
function matchedSections(
  db: Database.Database,
  query: string,
  blob: Buffer,
  page: { id: number; body: string }[],
): Map<number, MatchedSection[]> {
  const out = new Map<number, MatchedSection[]>();
  if (page.length === 0) return out;
  const placeholders = page.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT id, content_id, kind, chunk_key, heading_path, start_char, end_char, start_line, end_line,
           source_path, source_commit,
           CASE WHEN embedding IS NULL THEN NULL ELSE vec_distance_l2(embedding, ?) END AS d
    FROM content_chunks
    WHERE content_id IN (${placeholders})
  `).all(blob, ...page.map((p) => p.id)) as SectionRow[];
  if (rows.length === 0) return out;

  const terms = queryTerms(query);
  const bodyOf = new Map(page.map((p) => [p.id, p.body]));
  const textScore = new Map<number, number>();
  for (const r of rows) {
    if (r.kind !== "doc" || r.start_char === null || r.end_char === null) continue;
    const text = (bodyOf.get(r.content_id) ?? "").slice(r.start_char, r.end_char).toLowerCase();
    const n = terms.filter((t) => text.includes(t)).length;
    if (n > 0) textScore.set(r.id, n);
  }
  const sotIds = rows.filter((r) => r.kind === "sot").map((r) => r.id);
  const { tokens } = buildFtsQuery(query);
  if (sotIds.length > 0 && tokens.length > 0) {
    try {
      const hits = db.prepare(`
        SELECT rowid AS id, bm25(sot_chunks_fts, 2.0, 1.0) AS s FROM sot_chunks_fts
        WHERE sot_chunks_fts MATCH ? AND rowid IN (${sotIds.map(() => "?").join(",")})
      `).all(tokens.join(" OR "), ...sotIds) as { id: number; s: number }[];
      for (const h of hits) textScore.set(h.id, -h.s);
    } catch {
      // a query FTS5 cannot parse just yields no text matches
    }
  }

  const byDoc = new Map<number, SectionRow[]>();
  for (const r of rows) byDoc.set(r.content_id, [...(byDoc.get(r.content_id) ?? []), r]);
  for (const [docId, secs] of byDoc) {
    const vecOrder = secs.filter((s) => s.d !== null).sort((a, b) => a.d! - b.d!);
    const vecRank = new Map(vecOrder.map((s, i) => [s.id, i + 1]));
    const textOrder = secs.filter((s) => textScore.has(s.id)).sort((a, b) => textScore.get(b.id)! - textScore.get(a.id)!);
    const textRank = new Map(textOrder.map((s, i) => [s.id, i + 1]));
    const ranked = secs
      .map((s) => ({
        s,
        score: (vecRank.has(s.id) ? 1 / (RRF_K + vecRank.get(s.id)!) : 0) + (textRank.has(s.id) ? 1 / (RRF_K + textRank.get(s.id)!) : 0),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.s.start_line - b.s.start_line)
      .slice(0, MAX_MATCHED_SECTIONS);
    out.set(
      docId,
      ranked.map(({ s }) =>
        s.kind === "sot"
          ? { chunk_key: `${s.source_path}#${s.chunk_key}`, heading_path: s.heading_path, start_line: s.start_line, end_line: s.end_line, source_path: s.source_path!, source_commit: s.source_commit! }
          : { chunk_key: `${s.content_id}#${s.chunk_key}`, heading_path: s.heading_path, start_line: s.start_line, end_line: s.end_line },
      ),
    );
  }
  return out;
}

/** BM25 over SOT pointer tokens, folded to the card (content_id) by its best-scoring pointer. */
export function runSotFtsSearch(
  db: Database.Database,
  query: string,
  conditions: string[],
  filterParams: (string | number)[],
  limit: number,
): number[] {
  const { tokens } = buildFtsQuery(query);
  if (tokens.length === 0) return [];

  // bm25() cannot run inside an aggregate, so pointer scores are materialized first, then folded per card
  let sql = `
    WITH hits AS MATERIALIZED (
      SELECT cc.content_id AS id, bm25(sot_chunks_fts, 2.0, 1.0) AS s
      FROM sot_chunks_fts
      JOIN content_chunks cc ON cc.id = sot_chunks_fts.rowid
      JOIN contents c ON c.id = cc.content_id
      JOIN content_features cf ON cf.content_id = c.id
      JOIN features f ON cf.feature_id = f.id
      JOIN workspaces w ON f.workspace_id = w.id
      WHERE sot_chunks_fts MATCH ?
  `;
  if (conditions.length > 0) {
    sql += ` AND ${conditions.join(" AND ")}`;
  }
  sql += `
    )
    SELECT id, MIN(s) AS s FROM hits GROUP BY id ORDER BY s LIMIT ${limit}`;

  try {
    const stmt = db.prepare(sql);
    const andQuery = tokens.join(" AND ");
    const andResults = (stmt.all(andQuery, ...filterParams) as { id: number }[]).map(r => r.id);
    if (andResults.length > 0 || tokens.length === 1) return andResults;
    return (stmt.all(tokens.join(" OR "), ...filterParams) as { id: number }[]).map(r => r.id);
  } catch {
    return [];
  }
}

export function runFtsSearch(
  db: Database.Database,
  query: string,
  conditions: string[],
  filterParams: (string | number)[],
  limit: number,
): number[] {
  // CJK runs become bigram phrases, exactly as kb_cjk_bigram indexed them
  const { tokens } = buildFtsQuery(query);

  if (tokens.length === 0) return [];

  const andQuery = tokens.length === 1 ? tokens[0] : tokens.join(" AND ");

  let sql = `
    SELECT DISTINCT c.id
    FROM contents_fts fts
    JOIN contents c ON fts.rowid = c.id
    JOIN content_features cf ON cf.content_id = c.id
    JOIN features f ON cf.feature_id = f.id
    JOIN workspaces w ON f.workspace_id = w.id
    WHERE contents_fts MATCH ?
  `;
  if (conditions.length > 0) {
    sql += ` AND ${conditions.join(" AND ")}`;
  }
  sql += ` ORDER BY bm25(contents_fts, 5.0, 1.0) LIMIT ${limit}`;

  try {
    const stmt = db.prepare(sql);
    const andResults = (stmt.all(andQuery, ...filterParams) as { id: number }[]).map(r => r.id);
    if (andResults.length > 0 || tokens.length === 1) return andResults;
    // AND returned nothing — fall back to OR to preserve recall
    const orQuery = tokens.join(" OR ");
    return (stmt.all(orQuery, ...filterParams) as { id: number }[]).map(r => r.id);
  } catch {
    return [];
  }
}
