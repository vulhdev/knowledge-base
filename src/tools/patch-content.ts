import type Database from "better-sqlite3";
import type { Content } from "../types.js";
import { isModelReady, getEmbedding } from "../embedding/model.js";
import { fetchFeatures } from "./_helpers.js";

type RawRow = Omit<Content, "features" | "has_code_refs"> & { has_code_refs: number };

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

export async function patchContent(
  db: Database.Database,
  id: number,
  oldString: string,
  newString: string,
  replaceAll = false,
): Promise<Content> {
  const bodyRow = db
    .prepare("SELECT body FROM contents WHERE id = ?")
    .get(id) as { body: string } | undefined;

  if (!bodyRow) {
    throw new Error(`Content not found: id=${id}`);
  }

  const count = countOccurrences(bodyRow.body, oldString);

  if (count === 0) {
    throw new Error("String not found in document body");
  }

  if (count > 1 && !replaceAll) {
    throw new Error(
      `Ambiguous match: ${count} occurrences found. Provide more context in old_string, or set replace_all=true.`,
    );
  }

  const newBody = replaceAll
    ? bodyRow.body.replaceAll(oldString, newString)
    : bodyRow.body.replace(oldString, newString);

  db.prepare("UPDATE contents SET body = ?, updated_at = datetime('now') WHERE id = ?").run(
    newBody,
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
