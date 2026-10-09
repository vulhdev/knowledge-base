// Branch B: one card per SOT file plus pointer sections (path, commit, line range, hash, vector).
// The SOT text is read from git into memory to compute pointers and vectors, and is never stored.
import type Database from "better-sqlite3";
import { chunkMarkdown, chunkLines, breadcrumb, type Section } from "../text/chunker.js";
import { bigramIndexText } from "../text/cjk-bigram.js";
import { getTokenCounter } from "../embedding/tokenizer.js";
import { isModelReady, getEmbedding } from "../embedding/model.js";
import { createContent } from "../tools/create-content.js";
import { updateContent } from "../tools/update-content.js";
import { showAtCommit } from "./git.js";
import type { PlanCard } from "./plan.js";

export type SotOutcome = { status: "created" | "updated" | "unchanged"; id: number; pointers: number; filled: number };

function sectionText(lines: string[], s: Section): string {
  return lines.slice(s.start_line - 1, s.end_line).join("\n");
}

async function embedOrNull(text: string): Promise<Buffer | null> {
  if (!isModelReady()) return null;
  try {
    const v = await getEmbedding(text);
    return Buffer.from(v.buffer);
  } catch {
    // pointer embedding failure must not block the import — a re-run fills it
    return null;
  }
}

async function pointersFor(card: PlanCard): Promise<{ sections: Section[]; lines: string[] }> {
  const text = showAtCommit(card.repo_root, card.commit, card.repo_path);
  const count = await getTokenCounter();
  const sections = card.markdown ? chunkMarkdown(text, count) : chunkLines(text, count);
  return { sections, lines: text.split("\n") };
}

/** Import (or refresh) one SOT file. Card, pointers and pointer FTS are written in one transaction. */
export async function importSotCard(db: Database.Database, card: PlanCard): Promise<SotOutcome> {
  const existing = db
    .prepare("SELECT id, source_sha FROM contents WHERE source_key = ?")
    .get(card.source_key) as { id: number; source_sha: string } | undefined;

  if (existing && existing.source_sha === card.source_sha) {
    // Unchanged file: only fill pointer vectors a previous run could not compute.
    const missing = db
      .prepare("SELECT id, chunk_key FROM content_chunks WHERE content_id = ? AND kind = 'sot' AND embedding IS NULL")
      .all(existing.id) as { id: number; chunk_key: string }[];
    let filled = 0;
    if (missing.length > 0 && isModelReady()) {
      const { sections, lines } = await pointersFor(card);
      const byKey = new Map(sections.map((s) => [s.chunk_key, s]));
      const update = db.prepare("UPDATE content_chunks SET embedding = ? WHERE id = ?");
      for (const m of missing) {
        const s = byKey.get(m.chunk_key);
        if (!s) continue;
        const vec = await embedOrNull(`${breadcrumb(card.title, s.heading_path)}\n\n${sectionText(lines, s)}`);
        if (vec) {
          update.run(vec, m.id);
          filled++;
        }
      }
    }
    const pointers = (db.prepare("SELECT count(*) AS n FROM content_chunks WHERE content_id = ? AND kind = 'sot'").get(existing.id) as { n: number }).n;
    return { status: "unchanged", id: existing.id, pointers, filled };
  }

  // Everything that can fail or wait happens before the transaction opens.
  const { sections, lines } = await pointersFor(card);
  const vectors: (Buffer | null)[] = [];
  for (const s of sections) vectors.push(await embedOrNull(`${breadcrumb(card.title, s.heading_path)}\n\n${sectionText(lines, s)}`));

  const provenance = { source_key: card.source_key, source_sha: card.source_sha };
  const insertPointer = db.prepare(
    `INSERT INTO content_chunks (content_id, kind, chunk_key, ord, heading_path, start_char, end_char, start_line, end_line,
                                 source_path, source_commit, chunk_sha, embedding)
     VALUES (?, 'sot', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
  );
  const insertFts = db.prepare("INSERT INTO sot_chunks_fts (rowid, heading, body) VALUES (?, ?, ?)");

  db.exec("BEGIN");
  try {
    let id: number;
    if (existing) {
      await updateContent(db, existing.id, card.body, card.type, card.title, undefined, provenance);
      id = existing.id;
      // replace, never patch: old pointers (and, via trigger, their vectors and FTS rows) go first
      db.prepare("DELETE FROM content_chunks WHERE content_id = ? AND kind = 'sot'").run(id);
    } else {
      id = (await createContent(db, card.workspace, card.features, card.type, card.body, card.title, undefined, provenance)).id;
    }
    sections.forEach((s, i) => {
      const { lastInsertRowid } = insertPointer.run(
        id, s.chunk_key, s.ord, s.heading_path, s.start_line, s.end_line, card.repo_path, card.commit, s.chunk_sha, vectors[i],
      );
      insertFts.run(BigInt(lastInsertRowid), bigramIndexText(s.heading_path), bigramIndexText(sectionText(lines, s)));
    });
    db.exec("COMMIT");
    return { status: existing ? "updated" : "created", id, pointers: sections.length, filled: 0 };
  } catch (err) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw err;
  }
}

/** Delete cards (pointers cascade) under the scanned SOT folders whose file is no longer at the ref. */
export function removeMissingSotFiles(db: Database.Database, scopes: string[], present: Set<string>): number {
  let removed = 0;
  const del = db.prepare("DELETE FROM contents WHERE id = ?");
  for (const scope of scopes) {
    const rows = db
      .prepare("SELECT id, source_key FROM contents WHERE source_key LIKE ? ESCAPE '\\'")
      .all(scope.replace(/[\\%_]/g, (c) => `\\${c}`) + "%") as { id: number; source_key: string }[];
    for (const r of rows) {
      if (present.has(r.source_key)) continue;
      del.run(r.id);
      removed++;
    }
  }
  return removed;
}
