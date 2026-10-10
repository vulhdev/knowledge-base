import { describe, it, expect } from "vitest";
import { createTestDb } from "../setup.js";
import { applySchema } from "../../src/db/schema.js";

function seedDoc(db: ReturnType<typeof createTestDb>): number {
  db.exec("INSERT INTO workspaces (name) VALUES ('ws'); INSERT INTO features (workspace_id, name) VALUES (1, 'ft');");
  const id = Number(db.prepare("INSERT INTO contents (type, title, body) VALUES ('doc', 't', 'b')").run().lastInsertRowid);
  db.prepare("INSERT INTO content_features VALUES (?, 1)").run(id);
  return id;
}

const vec = () => Buffer.from(new Float32Array(384).fill(0.2).buffer);

describe("Migration 13 — content_chunks, sot_chunks_fts, vec_chunks", () => {
  it("creates content_chunks with the documented columns and no text column", () => {
    const db = createTestDb();
    const cols = (db.prepare("SELECT name, type, \"notnull\" AS nn FROM pragma_table_info('content_chunks')").all() as { name: string; type: string; nn: number }[]);
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    expect(Object.keys(byName).sort()).toEqual(
      ["chunk_key", "chunk_sha", "content_id", "embedding", "end_char", "end_line", "heading_path", "id", "kind", "ord", "source_commit", "source_path", "start_char", "start_line"].sort(),
    );
    expect(byName.content_id.nn).toBe(1);
    expect(byName.kind.nn).toBe(1);
    expect(byName.start_char.nn).toBe(0);
    expect(byName.start_line.nn).toBe(1);
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'content_chunks'").get() as { sql: string }).sql;
    expect(sql).toContain("REFERENCES contents(id) ON DELETE CASCADE");
    expect(sql).toContain("UNIQUE(content_id, kind, chunk_key)");
    const fts = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'sot_chunks_fts'").get() as { sql: string }).sql;
    expect(fts).toContain("contentless_delete=1");
  });

  it("enforces UNIQUE(content_id, kind, chunk_key)", () => {
    const db = createTestDb();
    const id = seedDoc(db);
    const ins = db.prepare("INSERT INTO content_chunks (content_id, kind, chunk_key, ord, heading_path, start_line, end_line, chunk_sha) VALUES (?, 'doc', '1', 0, 'h', 1, 1, 's')");
    ins.run(id);
    expect(() => ins.run(id)).toThrow(/UNIQUE/);
  });

  it("mirrors embeddings into vec_chunks and, when contents is deleted, cascades and cleans vec_chunks and sot_chunks_fts", () => {
    const db = createTestDb();
    const id = seedDoc(db);
    const ins = db.prepare("INSERT INTO content_chunks (content_id, kind, chunk_key, ord, heading_path, start_line, end_line, chunk_sha, embedding) VALUES (?, ?, ?, 0, 'h', 1, 1, 's', ?)");
    const doc = Number(ins.run(id, "doc", "1", vec()).lastInsertRowid);
    const sot = Number(ins.run(id, "sot", "1", vec()).lastInsertRowid);
    db.prepare("INSERT INTO sot_chunks_fts (rowid, heading, body) VALUES (?, 'h', '掛率 原価')").run(BigInt(sot));
    const count = (t: string) => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect(count("vec_chunks")).toBe(2);
    expect((db.prepare("SELECT rowid FROM sot_chunks_fts WHERE sot_chunks_fts MATCH '掛率'").all() as unknown[]).length).toBe(1);
    expect((db.prepare("SELECT heading, body FROM sot_chunks_fts").get() as { heading: unknown; body: unknown })).toEqual({ heading: null, body: null });

    db.prepare("UPDATE content_chunks SET embedding = ? WHERE id = ?").run(vec(), doc);
    expect(count("vec_chunks")).toBe(2);

    db.prepare("DELETE FROM contents WHERE id = ?").run(id);
    expect(count("content_chunks")).toBe(0);
    expect(count("vec_chunks")).toBe(0);
    expect((db.prepare("SELECT rowid FROM sot_chunks_fts WHERE sot_chunks_fts MATCH '掛率'").all() as unknown[]).length).toBe(0);
  });

  it("is idempotent", () => {
    const db = createTestDb();
    const id = seedDoc(db);
    db.prepare("INSERT INTO content_chunks (content_id, kind, chunk_key, ord, heading_path, start_line, end_line, chunk_sha) VALUES (?, 'doc', '1', 0, 'h', 1, 1, 's')").run(id);
    applySchema(db);
    applySchema(db);
    expect((db.prepare("SELECT count(*) AS n FROM content_chunks").get() as { n: number }).n).toBe(1);
  });
});
