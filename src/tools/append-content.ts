import type Database from "better-sqlite3";
import type { Content } from "../types.js";
import { isModelReady, getEmbedding } from "../embedding/model.js";
import { fetchFeatures } from "./_helpers.js";
import { prepareSections, writeDocSections, embedDocSections } from "./_chunks.js";

type RawRow = Omit<Content, "features" | "has_code_refs"> & { has_code_refs: number };

export async function appendContent(
  db: Database.Database,
  id: number,
  text: string,
): Promise<Content> {
  if (!text.trim()) {
    throw new Error("text must not be empty");
  }

  const bodyRow = db
    .prepare("SELECT body FROM contents WHERE id = ?")
    .get(id) as { body: string } | undefined;

  if (!bodyRow) {
    throw new Error(`Content not found: id=${id}`);
  }

  const newBody = bodyRow.body.endsWith("\n") ? bodyRow.body + text : bodyRow.body + "\n" + text;

  const sections = await prepareSections(newBody);

  db.transaction(() => {
    db.prepare("UPDATE contents SET body = ?, updated_at = datetime('now') WHERE id = ?").run(
      newBody,
      id,
    );
    writeDocSections(db, id, sections);
  })();

  if (isModelReady()) {
    getEmbedding(newBody)
      .then((embedding) => {
        const blob = Buffer.from(embedding.buffer);
        db.prepare("UPDATE contents SET embedding = ? WHERE id = ?").run(blob, id);
      })
      .catch(() => {
        // embedding failure must not prevent content update
      });
    // section embeddings follow the same fire-and-forget rule (embedDocSections never throws)
    void embedDocSections(db, id);
  }

  const row = db
    .prepare(
      `SELECT c.id, w.name AS workspace, c.type, c.title, c.body, c.created_at, c.updated_at,
              EXISTS(SELECT 1 FROM code_refs WHERE content_id = c.id) AS has_code_refs
       FROM contents c
       JOIN content_features cf ON cf.content_id = c.id
       JOIN features f ON cf.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?
       LIMIT 1`,
    )
    .get(id) as RawRow;

  return { ...row, features: fetchFeatures(db, id), has_code_refs: row.has_code_refs === 1 };
}
