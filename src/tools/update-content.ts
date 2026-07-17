import type Database from "better-sqlite3";
import type { Content, ContentType } from "../types.js";
import { isModelReady, getEmbedding } from "../embedding/model.js";

export async function updateContent(
  db: Database.Database,
  id: number,
  body: string,
  type?: ContentType,
  title?: string,
): Promise<Content> {
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

  if (isModelReady()) {
    try {
      const embedding = await getEmbedding(body);
      const blob = Buffer.from(embedding.buffer);
      db.prepare("UPDATE contents SET embedding = ? WHERE id = ?").run(blob, id);
    } catch {
      // embedding failure must not prevent content update
    }
  }

  const row = db
    .prepare(
      `SELECT c.id, w.name AS workspace, f.name AS feature, c.type, c.title, c.body, c.created_at, c.updated_at
       FROM contents c
       JOIN features f ON c.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?`,
    )
    .get(id) as Content;

  return row;
}
