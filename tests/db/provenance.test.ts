import { describe, it, expect, vi } from "vitest";
import { createTestDb } from "../setup.js";
import { applySchema } from "../../src/db/schema.js";

vi.mock("../../src/embedding/model.js", () => ({ isModelReady: vi.fn().mockReturnValue(false), getEmbedding: vi.fn() }));

import { createContent } from "../../src/tools/create-content.js";
import { updateContent } from "../../src/tools/update-content.js";

describe("Migration 13 — source_key / source_sha", () => {
  it("adds nullable source_key and source_sha with a partial unique index; idempotent", () => {
    const db = createTestDb();
    const cols = (db.prepare("SELECT name, \"notnull\" AS nn FROM pragma_table_info('contents')").all() as { name: string; nn: number }[]);
    expect(cols.find((c) => c.name === "source_key")?.nn).toBe(0);
    expect(cols.find((c) => c.name === "source_sha")?.nn).toBe(0);
    const idx = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_contents_source_key'").get() as { sql: string }).sql;
    expect(idx).toContain("WHERE source_key IS NOT NULL");
    applySchema(db);
    applySchema(db);
  });

  it("allows many NULL keys but refuses a duplicate key", () => {
    const db = createTestDb();
    const ins = db.prepare("INSERT INTO contents (type, body, source_key) VALUES ('doc', 'b', ?)");
    ins.run(null);
    ins.run(null);
    ins.run("doc:ws:a.md");
    expect(() => ins.run("doc:ws:a.md")).toThrow(/UNIQUE/);
  });
});

describe("provenance parameter of createContent / updateContent", () => {
  const prov = (db: ReturnType<typeof createTestDb>, id: number) =>
    db.prepare("SELECT source_key, source_sha FROM contents WHERE id = ?").get(id) as { source_key: string | null; source_sha: string | null };

  it("writes source_key / source_sha in the INSERT and the UPDATE", async () => {
    const db = createTestDb();
    const { id } = await createContent(db, "ws", ["ft"], "doc", "body", "t", undefined, { source_key: "doc:ws:a.md", source_sha: "s1" });
    expect(prov(db, id)).toEqual({ source_key: "doc:ws:a.md", source_sha: "s1" });
    await updateContent(db, id, "body 2", undefined, undefined, undefined, { source_key: "doc:ws:a.md", source_sha: "s2" });
    expect(prov(db, id)).toEqual({ source_key: "doc:ws:a.md", source_sha: "s2" });
  });

  it("without provenance behaves as before (NULL, and updates leave it alone)", async () => {
    const db = createTestDb();
    const { id } = await createContent(db, "ws", ["ft"], "doc", "body");
    expect(prov(db, id)).toEqual({ source_key: null, source_sha: null });
    const keyed = await createContent(db, "ws", ["ft"], "doc", "b", "t", undefined, { source_key: "doc:ws:k.md", source_sha: "x" });
    await updateContent(db, keyed.id, "changed by MCP");
    expect(prov(db, keyed.id)).toEqual({ source_key: "doc:ws:k.md", source_sha: "x" });
  });

  it("a duplicate source_key aborts the whole write (no orphan row)", async () => {
    const db = createTestDb();
    await createContent(db, "ws", ["ft"], "doc", "b", "t", undefined, { source_key: "doc:ws:a.md", source_sha: "x" });
    await expect(createContent(db, "ws", ["ft"], "doc", "b2", "t", undefined, { source_key: "doc:ws:a.md", source_sha: "y" })).rejects.toThrow(/UNIQUE/);
    expect((db.prepare("SELECT count(*) AS n FROM contents").get() as { n: number }).n).toBe(1);
  });

  it("an SOT card (sot: key) gets no doc sections", async () => {
    const db = createTestDb();
    const { id } = await createContent(db, "ws-sot", ["F-001"], "sot-spec", "# card\n- path: x", "card", undefined, { source_key: "sot:ws-sot:x.md", source_sha: "s" });
    expect((db.prepare("SELECT count(*) AS n FROM content_chunks WHERE content_id = ?").get(id) as { n: number }).n).toBe(0);
  });
});
