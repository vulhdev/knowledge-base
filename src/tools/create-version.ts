import type Database from "better-sqlite3";
import type { Content, CreateVersionResult } from "../types.js";
import { fetchFeatures } from "./_helpers.js";

type RawRow = Omit<Content, "features" | "has_code_refs"> & { has_code_refs: number; version_count: number };

export function createVersion(db: Database.Database, id: number): CreateVersionResult {
  const row = db
    .prepare(
      `SELECT c.id, c.root_id, c.version_number, c.type, c.title, c.body, c.created_at, c.updated_at, c.embedding,
              w.name AS workspace,
              EXISTS(SELECT 1 FROM code_refs WHERE content_id = c.id) AS has_code_refs
       FROM contents c
       JOIN content_features cf ON cf.content_id = c.id
       JOIN features f ON cf.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?
       LIMIT 1`,
    )
    .get(id) as (RawRow & { embedding: Buffer | null }) | undefined;

  if (!row) {
    throw new Error(`Content not found: id=${id}`);
  }

  const chainRoot = row.root_id ?? row.id;

  const newContent = db.transaction(() => {
    const { max_version } = db
      .prepare(
        `SELECT MAX(version_number) AS max_version
         FROM contents
         WHERE id = ? OR root_id = ?`,
      )
      .get(chainRoot, chainRoot) as { max_version: number };

    const prevLatest = db
      .prepare(`SELECT id FROM contents WHERE (id = ? OR root_id = ?) AND is_latest = 1`)
      .get(chainRoot, chainRoot) as { id: number } | undefined;

    if (prevLatest) {
      db.prepare("UPDATE contents SET is_latest = 0 WHERE id = ?").run(prevLatest.id);
    }

    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO contents (type, title, body, embedding, root_id, version_number, is_latest, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
      )
      .run(row.type, row.title, row.body, row.embedding, chainRoot, max_version + 1);

    const newId = Number(lastInsertRowid);

    // Same body, same sections: copy the doc sections (with their embeddings) so section search
    // covers the new version immediately instead of waiting for the next backfill
    db.prepare(
      `INSERT INTO content_chunks (content_id, kind, chunk_key, ord, heading_path, start_char, end_char,
                                   start_line, end_line, source_path, source_commit, chunk_sha, embedding)
       SELECT ?, kind, chunk_key, ord, heading_path, start_char, end_char,
              start_line, end_line, source_path, source_commit, chunk_sha, embedding
       FROM content_chunks WHERE content_id = ? AND kind = 'doc'`,
    ).run(newId, id);

    // Copy content_features
    db.prepare(
      `INSERT OR IGNORE INTO content_features (content_id, feature_id)
       SELECT ?, feature_id FROM content_features WHERE content_id = ?`,
    ).run(newId, id);

    // Copy content_links
    db.prepare(
      `INSERT OR IGNORE INTO content_links (parent_id, child_id, created_at)
       SELECT parent_id, ?, created_at FROM content_links WHERE child_id = ?`,
    ).run(newId, id);
    db.prepare(
      `INSERT OR IGNORE INTO content_links (parent_id, child_id, created_at)
       SELECT ?, child_id, created_at FROM content_links WHERE parent_id = ?`,
    ).run(newId, id);

    return newId;
  })();

  const newRow = db
    .prepare(
      `SELECT c.id, w.name AS workspace, c.type, c.title, c.body, c.root_id, c.version_number,
              c.created_at, c.updated_at,
              EXISTS(SELECT 1 FROM code_refs WHERE content_id = c.id) AS has_code_refs,
              (SELECT COUNT(*) FROM contents v
               WHERE v.id = COALESCE(c.root_id, c.id)
                  OR v.root_id = COALESCE(c.root_id, c.id)) AS version_count
       FROM contents c
       JOIN content_features cf ON cf.content_id = c.id
       JOIN features f ON cf.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?
       LIMIT 1`,
    )
    .get(newContent) as RawRow;

  const content: Content & { version_count: number } = {
    ...newRow,
    features: fetchFeatures(db, newContent),
    has_code_refs: newRow.has_code_refs === 1,
  };

  return { content, previous_version_id: id };
}
