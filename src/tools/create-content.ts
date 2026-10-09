import type Database from "better-sqlite3";
import type { ContentType, ConflictResult, CreateContentResult, SuggestedParent } from "../types.js";
import { isModelReady, getEmbedding } from "../embedding/model.js";
import { detectConflicts, type RequestSampling } from "./conflict-detection.js";
import { fetchFeatures } from "./_helpers.js";
import { typesAfter } from "./_type-order.js";
import { buildFtsQuery } from "../text/cjk-bigram.js";
import { prepareSections, writeDocSections, embedDocSections } from "./_chunks.js";

const SUGGEST_LIMIT = 3;
const SCORE_THRESHOLD = 0.25;

async function suggestParents(
  db: Database.Database,
  workspace: string,
  contentId: number,
  type: string,
  body: string,
  embeddingBlob: Buffer | null,
): Promise<SuggestedParent[]> {
  let excludedTypes: string[];
  try {
    excludedTypes = [...typesAfter(db, type)];
  } catch {
    excludedTypes = [type];
  }
  const typePlaceholders = excludedTypes.map(() => "?").join(", ");

  if (embeddingBlob) {
    try {
      type VecRow = { id: number; type: string; title: string | null; score: number };
      const rows = db
        .prepare(
          `SELECT c.id, c.type, c.title, v.distance AS score
           FROM vec_contents v
           JOIN contents c ON v.rowid = c.id
           JOIN content_features cf ON cf.content_id = c.id
           JOIN features f ON cf.feature_id = f.id
           JOIN workspaces w ON f.workspace_id = w.id
           WHERE v.embedding MATCH ? AND k = ?
             AND c.type NOT IN (${typePlaceholders})
             AND c.id != ?
             AND w.name = ?
           ORDER BY v.distance`,
        )
        .all(embeddingBlob, SUGGEST_LIMIT * 4, ...excludedTypes, contentId, workspace) as VecRow[];

      const filtered = rows.filter((r) => r.score <= SCORE_THRESHOLD).slice(0, SUGGEST_LIMIT);
      if (filtered.length > 0) {
        return filtered.map((r) => ({ id: r.id, type: r.type, title: r.title, score: r.score }));
      }
    } catch {
      // fall through to FTS
    }
  }

  // FTS fallback
  try {
    // Same tokenization as contents_fts: CJK runs become bigram phrases instead of being stripped
    const words = buildFtsQuery(body.trim().split(/\s+/).slice(0, 8).join(" "))
      .tokens.filter((w) => w.startsWith('"') && (/[^\x00-\x7F]/.test(w) || w.length - 2 > 2));

    if (words.length === 0) return [];

    const ftsQuery = words.join(" OR ");

    type FtsRow = { id: number; type: string; title: string | null };
    const rows = db
      .prepare(
        `SELECT c.id, c.type, c.title
         FROM contents_fts fts
         JOIN contents c ON fts.rowid = c.id
         JOIN content_features cf ON cf.content_id = c.id
         JOIN features f ON cf.feature_id = f.id
         JOIN workspaces w ON f.workspace_id = w.id
         WHERE contents_fts MATCH ?
           AND c.type NOT IN (${typePlaceholders})
           AND c.id != ?
           AND w.name = ?
         LIMIT ?`,
      )
      .all(ftsQuery, ...excludedTypes, contentId, workspace, SUGGEST_LIMIT) as FtsRow[];

    return rows.map((r) => ({ id: r.id, type: r.type, title: r.title, score: 0 }));
  } catch {
    return [];
  }
}

export async function createContent(
  db: Database.Database,
  workspace: string,
  features: string[],
  type: ContentType,
  body: string,
  title?: string,
  requestSampling?: RequestSampling,
): Promise<CreateContentResult> {
  if (!body.trim()) {
    throw new Error("body must not be empty");
  }
  if (features.length === 0) {
    throw new Error("features must not be empty");
  }

  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(workspace);
  const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(workspace) as { id: number };

  const featureIds: number[] = [];
  for (const featureName of features) {
    db.prepare("INSERT OR IGNORE INTO features (workspace_id, name) VALUES (?, ?)").run(ws.id, featureName);
    const ft = db.prepare("SELECT id FROM features WHERE workspace_id = ? AND name = ?").get(ws.id, featureName) as { id: number };
    featureIds.push(ft.id);
  }

  if (type === "digest") {
    for (let i = 0; i < featureIds.length; i++) {
      const existing = db
        .prepare(
          `SELECT c.id FROM content_features cf
           JOIN contents c ON cf.content_id = c.id
           WHERE cf.feature_id = ? AND c.type = 'digest'`,
        )
        .get(featureIds[i]) as { id: number } | undefined;
      if (existing) {
        throw new Error(
          `A digest already exists for feature '${features[i]}'. Use update_content (id=${existing.id}) to modify it.`,
        );
      }
    }
  }

  // Sections are computed before the transaction (the token counter is async); the row, its
  // features and its sections are then written atomically.
  const sections = await prepareSections(body);

  const contentId = db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO contents (type, title, body) VALUES (?, ?, ?)")
      .run(type, title ?? null, body);

    const id = Number(lastInsertRowid);

    for (const featureId of featureIds) {
      db.prepare("INSERT INTO content_features (content_id, feature_id) VALUES (?, ?)").run(id, featureId);
    }

    writeDocSections(db, id, sections);
    return id;
  })();

  let embeddingBlob: Buffer | null = null;

  if (isModelReady()) {
    try {
      const embedding = await getEmbedding(body);
      embeddingBlob = Buffer.from(embedding.buffer);
      db.prepare("UPDATE contents SET embedding = ? WHERE id = ?").run(embeddingBlob, contentId);
    } catch {
      // embedding failure must not prevent content creation
    }
  }

  await embedDocSections(db, contentId);

  const featureNamesSorted = fetchFeatures(db, contentId);

  let conflicts: ConflictResult[] = [];
  if (requestSampling && embeddingBlob) {
    try {
      conflicts = await detectConflicts(db, contentId, workspace, featureNamesSorted, type, body, embeddingBlob, requestSampling);
    } catch {
      // conflict detection failure must not prevent content creation
    }
  }

  const row = db
    .prepare("SELECT id, title, created_at FROM contents WHERE id = ?")
    .get(contentId) as { id: number; title: string | null; created_at: string };

  const suggested_parents = await suggestParents(db, workspace, contentId, type, body, embeddingBlob);

  return { id: row.id, workspace, features: featureNamesSorted, type, title: row.title, created_at: row.created_at, conflicts, suggested_parents };
}
