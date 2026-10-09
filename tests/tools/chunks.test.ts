import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(true),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
}));

import { prepareSections, writeDocSections, embedDocSections, embedPendingDocSections, isSotCard } from "../../src/tools/_chunks.js";
import { isModelReady, getEmbedding } from "../../src/embedding/model.js";

const BODY = ["# 見積", "見積金額は原価に掛率を乗じて算出する。".repeat(4), "## 端数", "端数処理は切り捨てとする。".repeat(6), "## 回次", "回次は案件と取引先で通算する。".repeat(5)].join("\n");

function seed(db: Database.Database, body = BODY, title: string | null = "見積の手引き"): number {
  db.exec("INSERT OR IGNORE INTO workspaces (name) VALUES ('ws'); INSERT OR IGNORE INTO features (workspace_id, name) VALUES (1, 'ft');");
  const id = Number(db.prepare("INSERT INTO contents (type, title, body) VALUES ('doc', ?, ?)").run(title, body).lastInsertRowid);
  db.prepare("INSERT INTO content_features VALUES (?, 1)").run(id);
  return id;
}
const rows = (db: Database.Database, id: number) =>
  db.prepare("SELECT id, chunk_key, chunk_sha, heading_path, start_char, end_char, embedding IS NOT NULL AS has FROM content_chunks WHERE content_id = ? AND kind = 'doc' ORDER BY ord").all(id) as
    { id: number; chunk_key: string; chunk_sha: string; heading_path: string; start_char: number; end_char: number; has: number }[];

describe("_chunks", () => {
  let db: Database.Database;
  beforeEach(() => {
    vi.mocked(isModelReady).mockReturnValue(true);
    vi.mocked(getEmbedding).mockReset().mockResolvedValue(new Float32Array(384).fill(0.1));
    db = createTestDb();
  });

  it("prepareSections splits by heading", async () => {
    expect((await prepareSections(BODY)).map((s) => s.chunk_key)).toEqual(["1", "1.1", "1.2"]);
  });

  it("writeDocSections inserts offset-only rows; embedDocSections embeds them with a breadcrumb", async () => {
    const id = seed(db);
    const secs = await prepareSections(BODY);
    db.transaction(() => writeDocSections(db, id, secs))();
    expect(rows(db, id).map((r) => r.chunk_key)).toEqual(["1", "1.1", "1.2"]);
    await embedDocSections(db, id);
    expect(rows(db, id).every((r) => r.has === 1)).toBe(true);
    const texts = vi.mocked(getEmbedding).mock.calls.map((c) => c[0]);
    expect(texts[1].startsWith("見積の手引き › 見積 › 端数\n\n")).toBe(true);
    expect((db.prepare("SELECT count(*) AS n FROM vec_chunks").get() as { n: number }).n).toBe(3);
  });

  it("keeps rows (and embeddings) whose key, hash and heading are unchanged; replaces the rest", async () => {
    const id = seed(db);
    writeDocSections(db, id, await prepareSections(BODY));
    await embedDocSections(db, id);
    const before = rows(db, id);
    const edited = BODY.replace("回次は案件と", "回次は引き合いと");
    db.prepare("UPDATE contents SET body = ? WHERE id = ?").run(edited, id);
    writeDocSections(db, id, await prepareSections(edited));
    const after = rows(db, id);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].has).toBe(1);
    expect(after[1].id).toBe(before[1].id);
    expect(after[2].id).not.toBe(before[2].id);
    expect(after[2].has).toBe(0);
    vi.mocked(getEmbedding).mockClear();
    await embedDocSections(db, id);
    expect(vi.mocked(getEmbedding)).toHaveBeenCalledTimes(1);
  });

  it("refreshes offsets of kept rows when an earlier section changes length", async () => {
    const id = seed(db);
    writeDocSections(db, id, await prepareSections(BODY));
    const edited = BODY.replace("# 見積\n", "# 見積\n追加の一文。追加の一文。\n");
    writeDocSections(db, id, await prepareSections(edited));
    const last = rows(db, id)[2];
    expect(edited.slice(last.start_char, last.end_char).startsWith("## 回次")).toBe(true);
  });

  it("a title change re-inserts every section (breadcrumb changed)", async () => {
    const id = seed(db);
    writeDocSections(db, id, await prepareSections(BODY));
    const before = rows(db, id).map((r) => r.id);
    writeDocSections(db, id, await prepareSections(BODY), true);
    expect(rows(db, id).map((r) => r.id).some((x) => before.includes(x))).toBe(false);
  });

  it("swallows embedding failures", async () => {
    const id = seed(db);
    writeDocSections(db, id, await prepareSections(BODY));
    vi.mocked(getEmbedding).mockRejectedValue(new Error("onnx down"));
    await expect(embedDocSections(db, id)).resolves.toBeUndefined();
    expect(rows(db, id).every((r) => r.has === 0)).toBe(true);
  });

  it("does nothing when the model is absent", async () => {
    const id = seed(db);
    writeDocSections(db, id, await prepareSections(BODY));
    vi.mocked(isModelReady).mockReturnValue(false);
    await embedDocSections(db, id);
    expect(vi.mocked(getEmbedding)).not.toHaveBeenCalled();
    expect(await embedPendingDocSections(db)).toBe(0);
  });

  it("embedPendingDocSections sections docs that have none and embeds missing ones", async () => {
    const a = seed(db);
    const b = seed(db, "# B\n" + "本文".repeat(40));
    writeDocSections(db, b, await prepareSections("# B\n" + "本文".repeat(40)));
    expect(await embedPendingDocSections(db)).toBe(2);
    expect(rows(db, a).length).toBe(3);
    expect(rows(db, a).every((r) => r.has === 1)).toBe(true);
    expect(rows(db, b).every((r) => r.has === 1)).toBe(true);
    expect(await embedPendingDocSections(db)).toBe(0);
  });

  it("never creates doc sections for an SOT card", async () => {
    db.exec("ALTER TABLE contents ADD COLUMN source_key TEXT");
    const id = seed(db);
    db.prepare("UPDATE contents SET source_key = 'sot:ws-sot:docs/F-001.md' WHERE id = ?").run(id);
    expect(isSotCard(db, id)).toBe(true);
    writeDocSections(db, id, await prepareSections(BODY));
    expect(rows(db, id)).toEqual([]);
  });
});

