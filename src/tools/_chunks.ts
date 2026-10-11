// Doc sections: computed from the body on every write, stored offset-only in content_chunks
// (kind = 'doc'), embedded with a breadcrumb prefix. SOT pointers (kind = 'sot') are owned by the
// importer and never touched here.
import type Database from "better-sqlite3";
import { chunkMarkdown, breadcrumb, type Section } from "../text/chunker.js";
import { getTokenCounter } from "../embedding/tokenizer.js";
import { isModelReady, getEmbedding } from "../embedding/model.js";

type ChunkRow = { id: number; chunk_key: string; chunk_sha: string; heading_path: string };

/** Split a body into sections. Async because the token counter may load the model tokenizer. */
export async function prepareSections(body: string): Promise<Section[]> {
  const count = await getTokenCounter();
  return chunkMarkdown(body, count);
}

const hasSourceKey = new WeakMap<Database.Database, boolean>();

function hasSourceKeyColumn(db: Database.Database): boolean {
  if (!hasSourceKey.has(db)) {
    hasSourceKey.set(db, !!db.prepare("SELECT 1 FROM pragma_table_info('contents') WHERE name = 'source_key'").get());
  }
  return hasSourceKey.get(db)!;
}

/** SOT cards (source_key 'sot:…') get pointers from the importer, never doc sections. */
export function isSotCard(db: Database.Database, contentId: number): boolean {
  if (!hasSourceKeyColumn(db)) return false;
  const row = db.prepare("SELECT source_key FROM contents WHERE id = ?").get(contentId) as { source_key: string | null } | undefined;
  return !!row?.source_key?.startsWith("sot:");
}

/**
 * Replace the doc sections of a content row. Must run inside the same transaction as the write of
 * the body. A row whose key, hash and heading path are unchanged keeps its embedding (its offsets
 * are refreshed) unless the title changed; everything else is deleted and re-inserted unembedded.
 */
export function writeDocSections(db: Database.Database, contentId: number, sections: Section[], titleChanged = false): void {
  if (isSotCard(db, contentId)) return;
  const existing = db
    .prepare("SELECT id, chunk_key, chunk_sha, heading_path FROM content_chunks WHERE content_id = ? AND kind = 'doc'")
    .all(contentId) as ChunkRow[];
  const byKey = new Map(existing.map((r) => [r.chunk_key, r]));
  const keep = new Set<number>();

  const refresh = db.prepare("UPDATE content_chunks SET ord = ?, start_char = ?, end_char = ?, start_line = ?, end_line = ? WHERE id = ?");
  const insert = db.prepare(
    `INSERT INTO content_chunks (content_id, kind, chunk_key, ord, heading_path, start_char, end_char, start_line, end_line, chunk_sha)
     VALUES (?, 'doc', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const toInsert: Section[] = [];
  for (const s of sections) {
    const old = byKey.get(s.chunk_key);
    if (!titleChanged && old && old.chunk_sha === s.chunk_sha && old.heading_path === s.heading_path) {
      keep.add(old.id);
      refresh.run(s.ord, s.start_char, s.end_char, s.start_line, s.end_line, old.id);
    } else {
      toInsert.push(s);
    }
  }
  const del = db.prepare("DELETE FROM content_chunks WHERE id = ?");
  for (const r of existing) if (!keep.has(r.id)) del.run(r.id);
  for (const s of toInsert) {
    insert.run(contentId, s.chunk_key, s.ord, s.heading_path, s.start_char, s.end_char, s.start_line, s.end_line, s.chunk_sha);
  }
}

type PendingRow = { id: number; chunk_key: string; chunk_sha: string; ord: number; heading_path: string; start_char: number; end_char: number };

/** Last paragraph of the previous part, prepended to part n >= 2 as embedding overlap (never stored). */
function overlapFor(body: string, rows: PendingRow[], row: PendingRow): string {
  if (!row.chunk_key.includes("~")) return "";
  const prev = rows.find((r) => r.ord === row.ord - 1);
  if (!prev) return "";
  const paras = body.slice(prev.start_char, prev.end_char).split(/\n\s*\n/).filter((p) => p.trim() !== "");
  return paras.length ? paras[paras.length - 1] + "\n\n" : "";
}

/** Embed the doc sections of one content row that have no embedding yet. Never throws. */
export async function embedDocSections(db: Database.Database, contentId: number): Promise<void> {
  if (!isModelReady()) return;
  const doc = db.prepare("SELECT title, body FROM contents WHERE id = ?").get(contentId) as { title: string | null; body: string } | undefined;
  if (!doc) return;
  const rows = db
    .prepare("SELECT id, chunk_key, chunk_sha, ord, heading_path, start_char, end_char FROM content_chunks WHERE content_id = ? AND kind = 'doc' ORDER BY ord")
    .all(contentId) as PendingRow[];
  const pending = db.prepare("SELECT id FROM content_chunks WHERE content_id = ? AND kind = 'doc' AND embedding IS NULL").all(contentId) as { id: number }[];
  const pendingIds = new Set(pending.map((p) => p.id));
  // chunk_sha guards against a row rewritten (and its id reused) while the model was running
  const update = db.prepare("UPDATE content_chunks SET embedding = ? WHERE id = ? AND chunk_sha = ?");
  for (const row of rows) {
    if (!pendingIds.has(row.id)) continue;
    try {
      const head = breadcrumb(doc.title, row.heading_path);
      const section = `${overlapFor(doc.body, rows, row)}${doc.body.slice(row.start_char, row.end_char)}`;
      const text = head ? `${head}\n\n${section}` : section;
      const embedding = await getEmbedding(text);
      update.run(Buffer.from(embedding.buffer), row.id, row.chunk_sha);
    } catch {
      // section embedding failure must not prevent the document write — backfill retries it
    }
  }
}

/**
 * Re-section with the current token counter (the real tokenizer once the model is present) every
 * non-SOT doc that has no sections or has sections without embeddings, then embed them.
 */
export async function embedPendingDocSections(db: Database.Database): Promise<number> {
  if (!isModelReady()) return 0;
  const sotFilter = hasSourceKeyColumn(db) ? "AND (c.source_key IS NULL OR c.source_key NOT LIKE 'sot:%')" : "";
  const ids = (
    db
      .prepare(
        `SELECT c.id FROM contents c
         WHERE (NOT EXISTS (SELECT 1 FROM content_chunks k WHERE k.content_id = c.id AND k.kind = 'doc')
            OR EXISTS (SELECT 1 FROM content_chunks k WHERE k.content_id = c.id AND k.kind = 'doc' AND k.embedding IS NULL))
         ${sotFilter}`,
      )
      .all() as { id: number }[]
  ).map((r) => r.id);
  for (const id of ids) {
    try {
      const { body } = db.prepare("SELECT body FROM contents WHERE id = ?").get(id) as { body: string };
      const sections = await prepareSections(body);
      db.transaction(() => writeDocSections(db, id, sections))();
      await embedDocSections(db, id);
    } catch {
      // backfill failure for one doc must not stop the others
    }
  }
  return ids.length;
}

