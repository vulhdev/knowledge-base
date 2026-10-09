import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(true),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
}));

import { createContent } from "../../src/tools/create-content.js";
import { updateContent } from "../../src/tools/update-content.js";
import { patchContent } from "../../src/tools/patch-content.js";
import { appendContent } from "../../src/tools/append-content.js";
import { deriveContent } from "../../src/tools/derive-content.js";
import { deleteContent } from "../../src/tools/delete-content.js";
import { isModelReady, getEmbedding } from "../../src/embedding/model.js";

const sec = (title: string, n = 60) => `## ${title}\n${"本文".repeat(n)}`;
const BODY = ["# 手引き", "前置き".repeat(20), sec("掛率"), sec("端数")].join("\n");

const keys = (db: Database.Database, id: number) =>
  (db.prepare("SELECT chunk_key, heading_path FROM content_chunks WHERE content_id = ? AND kind = 'doc' ORDER BY ord").all(id) as { chunk_key: string; heading_path: string }[]);
const count = (db: Database.Database, t: string) => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
const flush = () => new Promise((r) => setTimeout(r, 20));

describe("write paths keep sections in step with the body", () => {
  let db: Database.Database;
  beforeEach(() => {
    vi.mocked(isModelReady).mockReturnValue(true);
    vi.mocked(getEmbedding).mockReset().mockResolvedValue(new Float32Array(384).fill(0.1));
    db = createTestDb();
  });

  it("createContent writes sections and embeds them", async () => {
    const { id } = await createContent(db, "ws", ["ft"], "doc", BODY, "T");
    expect(keys(db, id).map((k) => k.chunk_key)).toEqual(["1", "1.1", "1.2"]);
    expect(count(db, "vec_chunks")).toBe(3);
  });

  it("updateContent recomputes sections; removed sections disappear", async () => {
    const { id } = await createContent(db, "ws", ["ft"], "doc", BODY, "T");
    await updateContent(db, id, ["# 手引き", "前置き".repeat(20), sec("掛率")].join("\n"));
    expect(keys(db, id).map((k) => k.heading_path)).toEqual(["手引き", "手引き › 掛率"]);
    expect(count(db, "vec_chunks")).toBe(2);
  });

  it("patchContent and appendContent recompute sections", async () => {
    const { id } = await createContent(db, "ws", ["ft"], "doc", BODY, "T");
    await patchContent(db, id, "## 端数", "## 端数処理");
    expect(keys(db, id).map((k) => k.heading_path)).toContain("手引き › 端数処理");
    await appendContent(db, id, sec("回次"));
    expect(keys(db, id).map((k) => k.heading_path)).toContain("手引き › 回次");
    await flush();
    expect(count(db, "content_chunks")).toBe(count(db, "vec_chunks"));
  });

  it("deriveContent gets sections through createContent", async () => {
    const parent = await createContent(db, "ws", ["ft"], "idea", "parent body");
    const child = await deriveContent(db, parent.id, "spec", BODY, "child");
    expect(keys(db, child.id).length).toBe(3);
  });

  it("deleteContent removes sections and their vectors", async () => {
    const { id } = await createContent(db, "ws", ["ft"], "doc", BODY, "T");
    deleteContent(db, id);
    expect(count(db, "content_chunks")).toBe(0);
    expect(count(db, "vec_chunks")).toBe(0);
  });

  it("a DB error while writing sections rolls back the document as well", async () => {
    db.exec("CREATE TRIGGER boom BEFORE INSERT ON content_chunks BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    await expect(createContent(db, "ws", ["ft"], "doc", BODY, "T")).rejects.toThrow(/boom/);
    expect(count(db, "contents")).toBe(0);
    db.exec("DROP TRIGGER boom");
    const { id } = await createContent(db, "ws", ["ft"], "doc", BODY, "T");
    db.exec("CREATE TRIGGER boom BEFORE INSERT ON content_chunks BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    await expect(updateContent(db, id, "# 別\n" + "x".repeat(300))).rejects.toThrow(/boom/);
    expect((db.prepare("SELECT body FROM contents WHERE id = ?").get(id) as { body: string }).body).toBe(BODY);
  });

  it("an embedding failure does not stop the write", async () => {
    vi.mocked(getEmbedding).mockRejectedValue(new Error("onnx down"));
    const { id } = await createContent(db, "ws", ["ft"], "doc", BODY, "T");
    expect(keys(db, id).length).toBe(3);
    expect(count(db, "vec_chunks")).toBe(0);
  });
});
