import type Database from "better-sqlite3";
import type { Content } from "../types.js";
import { fetchFeatures } from "./_helpers.js";

type RawRow = Omit<Content, "features" | "has_code_refs">;

export function deleteContent(db: Database.Database, id: number, cascade = false): Content {
  const row = db
    .prepare(
      `SELECT c.id, w.name AS workspace, c.type, c.body, c.title, c.root_id, c.version_number,
              c.is_latest, c.created_at, c.updated_at
       FROM contents c
       JOIN content_features cf ON cf.content_id = c.id
       JOIN features f ON cf.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?
       LIMIT 1`,
    )
    .get(id) as (RawRow & { is_latest: number }) | undefined;

  if (!row) {
    throw new Error(`Content not found: id=${id}`);
  }

  const features = fetchFeatures(db, id);

  if (cascade) {
    // Path 4: delete entire version chain
    const chainRoot = row.root_id ?? row.id;
    db.transaction(() => {
      db.prepare("DELETE FROM contents WHERE id = ? OR root_id = ?").run(chainRoot, chainRoot);
    })();
    return { ...row, features, has_code_refs: false };
  }

  const chainRoot = row.root_id ?? row.id;
  const hasOtherVersions = (
    db.prepare("SELECT COUNT(*) AS cnt FROM contents WHERE (id = ? OR root_id = ?) AND id != ?")
      .get(chainRoot, chainRoot, id) as { cnt: number }
  ).cnt > 0;

  if (!hasOtherVersions) {
    // Path 1: sole version — existing behavior
    db.prepare("DELETE FROM contents WHERE id = ?").run(id);
    return { ...row, features, has_code_refs: false };
  }

  if (row.root_id !== null) {
    // Path 2: non-root version — delete + renumber remaining in chain
    db.transaction(() => {
      db.prepare("DELETE FROM contents WHERE id = ?").run(id);
      db.prepare(
        `UPDATE contents SET version_number = version_number - 1
         WHERE root_id = ? AND version_number > ?`,
      ).run(row.root_id, row.version_number);
      // Restore is_latest if we deleted the latest
      if (row.is_latest === 1) {
        const newLatest = db
          .prepare("SELECT id FROM contents WHERE (id = ? OR root_id = ?) ORDER BY version_number DESC LIMIT 1")
          .get(chainRoot, chainRoot) as { id: number } | undefined;
        if (newLatest) {
          db.prepare("UPDATE contents SET is_latest = 1 WHERE id = ?").run(newLatest.id);
        }
      }
    })();
    return { ...row, features, has_code_refs: false };
  }

  // Path 3: root version with children — promote v2 to root
  db.transaction(() => {
    const newRoot = db
      .prepare("SELECT id FROM contents WHERE root_id = ? ORDER BY version_number ASC LIMIT 1")
      .get(id) as { id: number };

    // All other children get root_id updated to new root
    db.prepare("UPDATE contents SET root_id = ? WHERE root_id = ? AND id != ?").run(newRoot.id, id, newRoot.id);
    // Promote v2 to root and renumber it to 1
    db.prepare("UPDATE contents SET root_id = NULL, version_number = 1 WHERE id = ?").run(newRoot.id);
    // Renumber remaining children relative to new root start
    db.prepare(
      `UPDATE contents SET version_number = version_number - 1
       WHERE root_id = ?`,
    ).run(newRoot.id);

    db.prepare("DELETE FROM contents WHERE id = ?").run(id);
  })();

  return { ...row, features, has_code_refs: false };
}
