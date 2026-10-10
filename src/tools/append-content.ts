import type Database from "better-sqlite3";
import type { Content } from "../types.js";
import { isModelReady, getEmbedding } from "../embedding/model.js";
import { fetchFeatures } from "./_helpers.js";
import { authCtx } from "../auth/middleware.js";

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

  const updated_by = authCtx.getStore()?.github_login ?? null;

  db.prepare("UPDATE contents SET body = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
    newBody,
    updated_by,
    id,
  );

  if (isModelReady()) {
    getEmbedding(newBody)
      .then((embedding) => {
        const blob = Buffer.from(embedding.buffer);
        db.prepare("UPDATE contents SET embedding = ? WHERE id = ?").run(blob, id);
      })
      .catch(() => {
        // embedding failure must not prevent content update
      });
  }

  const row = db
    .prepare(
      `SELECT c.id, w.name AS workspace, c.type, c.title, c.body, c.root_id, c.version_number,
              c.created_at, c.updated_at, c.created_by, c.updated_by,
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
