import type Database from "better-sqlite3";
import type { Content, ContentType, ConflictResult, UpdateContentResult } from "../types.js";

type RawRow = Omit<Content, "has_code_refs"> & { has_code_refs: number };
import { isModelReady, getEmbedding } from "../embedding/model.js";
import { detectConflicts, type RequestSampling } from "./conflict-detection.js";

export async function updateContent(
  db: Database.Database,
  id: number,
  body: string,
  type?: ContentType,
  title?: string,
  requestSampling?: RequestSampling,
): Promise<UpdateContentResult> {
  if (!body.trim()) {
    throw new Error("body must not be empty");
  }

  const { changes } = db
    .prepare(
      `UPDATE contents
       SET body = ?, type = COALESCE(?, type), title = COALESCE(?, title), updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(body, type ?? null, title ?? null, id);

  if (changes === 0) {
    throw new Error(`Content not found: id=${id}`);
  }

  let embeddingBlob: Buffer | null = null;

  if (isModelReady()) {
    try {
      const embedding = await getEmbedding(body);
      embeddingBlob = Buffer.from(embedding.buffer);
      db.prepare("UPDATE contents SET embedding = ? WHERE id = ?").run(embeddingBlob, id);
    } catch {
      // embedding failure must not prevent content update
    }
  }

  const row = db
    .prepare(
      `SELECT c.id, w.name AS workspace, f.name AS feature, c.type, c.title, c.body, c.created_at, c.updated_at,
              EXISTS(SELECT 1 FROM code_refs WHERE content_id = c.id) AS has_code_refs
       FROM contents c
       JOIN features f ON c.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?`,
    )
    .get(id) as RawRow;

  let conflicts: ConflictResult[] = [];
  if (requestSampling && embeddingBlob) {
    try {
      conflicts = await detectConflicts(db, id, row.workspace, row.feature, row.type, body, embeddingBlob, requestSampling);
    } catch {
      // conflict detection failure must not prevent content update
    }
  }

  return { ...row, has_code_refs: row.has_code_refs === 1, conflicts };
}
