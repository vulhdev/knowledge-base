import type Database from "better-sqlite3";
import type { ContentType, ConflictResult, CreateContentResult, SuggestedParent } from "../types.js";
import { isModelReady, getEmbedding } from "../embedding/model.js";
import { detectConflicts, type RequestSampling } from "./conflict-detection.js";

const PARENT_TYPE: Record<string, string> = { spec: "idea", plan: "spec" };
const SUGGEST_LIMIT = 3;
const SCORE_THRESHOLD = 0.25;

async function suggestParents(
  db: Database.Database,
  workspace: string,
  type: string,
  body: string,
  embeddingBlob: Buffer | null,
): Promise<SuggestedParent[]> {
  const parentType = PARENT_TYPE[type];
  if (!parentType) return [];

  if (embeddingBlob) {
    try {
      type VecRow = { id: number; type: string; title: string | null; score: number };
      const rows = db
        .prepare(
          `SELECT c.id, c.type, c.title, v.distance AS score
           FROM vec_contents v
           JOIN contents c ON v.rowid = c.id
           JOIN features f ON c.feature_id = f.id
           JOIN workspaces w ON f.workspace_id = w.id
           WHERE v.embedding MATCH ? AND k = ?
             AND c.type = ?
             AND w.name = ?
           ORDER BY v.distance`,
        )
        .all(embeddingBlob, SUGGEST_LIMIT * 4, parentType, workspace) as VecRow[];

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
    const words = body
      .trim()
      .split(/\s+/)
      .slice(0, 8)
      .map((w) => w.replace(/[^\w]/g, ""))
      .filter((w) => w.length > 2);

    if (words.length === 0) return [];

    const ftsQuery = words.join(" OR ");

    type FtsRow = { id: number; type: string; title: string | null };
    const rows = db
      .prepare(
        `SELECT c.id, c.type, c.title
         FROM contents_fts fts
         JOIN contents c ON fts.rowid = c.id
         JOIN features f ON c.feature_id = f.id
         JOIN workspaces w ON f.workspace_id = w.id
         WHERE contents_fts MATCH ?
           AND c.type = ?
           AND w.name = ?
         LIMIT ?`,
      )
      .all(ftsQuery, parentType, workspace, SUGGEST_LIMIT) as FtsRow[];

    return rows.map((r) => ({ id: r.id, type: r.type, title: r.title, score: 0 }));
  } catch {
    return [];
  }
}

export async function createContent(
  db: Database.Database,
  workspace: string,
  feature: string,
  type: ContentType,
  body: string,
  title?: string,
  requestSampling?: RequestSampling,
): Promise<CreateContentResult> {
  if (!body.trim()) {
    throw new Error("body must not be empty");
  }

  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(workspace);
  const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(workspace) as { id: number };

  db.prepare("INSERT OR IGNORE INTO features (workspace_id, name) VALUES (?, ?)").run(ws.id, feature);
  const ft = db.prepare("SELECT id FROM features WHERE workspace_id = ? AND name = ?").get(ws.id, feature) as { id: number };

  if (type === "digest") {
    const existing = db
      .prepare("SELECT id FROM contents WHERE feature_id = ? AND type = 'digest'")
      .get(ft.id) as { id: number } | undefined;
    if (existing) {
      throw new Error(
        `A digest already exists for feature '${feature}'. Use update_content (id=${existing.id}) to modify it.`,
      );
    }
  }

  const { lastInsertRowid } = db
    .prepare("INSERT INTO contents (feature_id, type, title, body) VALUES (?, ?, ?, ?)")
    .run(ft.id, type, title ?? null, body);

  const contentId = Number(lastInsertRowid);

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

  let conflicts: ConflictResult[] = [];
  if (requestSampling && embeddingBlob) {
    try {
      conflicts = await detectConflicts(db, contentId, workspace, feature, type, body, embeddingBlob, requestSampling);
    } catch {
      // conflict detection failure must not prevent content creation
    }
  }

  const row = db
    .prepare("SELECT id, title, created_at FROM contents WHERE id = ?")
    .get(contentId) as { id: number; title: string | null; created_at: string };

  const suggested_parents = await suggestParents(db, workspace, type, body, embeddingBlob);

  return { id: row.id, workspace, feature, type, title: row.title, created_at: row.created_at, conflicts, suggested_parents };
}
