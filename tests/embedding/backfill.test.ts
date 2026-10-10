import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.5)),
}));

describe("startBackfill", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { isModelReady, getEmbedding } = await import("../../src/embedding/model.js");
    vi.mocked(isModelReady).mockReturnValue(false);
    vi.mocked(getEmbedding).mockResolvedValue(new Float32Array(384).fill(0.5));
  });

  it("fills embedding for rows with embedding IS NULL", async () => {
    const { isModelReady } = await import("../../src/embedding/model.js");
    const db = createTestDb();

    // Create content while model is not ready — no embedding stored
    await createContent(db, "ws", ["ft"], "idea", "some body");
    const before = db.prepare("SELECT embedding FROM contents WHERE body = 'some body'").get() as { embedding: Buffer | null };
    expect(before.embedding).toBeNull();

    // Now model is ready — backfill should fill it
    vi.mocked(isModelReady).mockReturnValue(true);
    const { startBackfill } = await import("../../src/embedding/backfill.js");
    await new Promise<void>((resolve) => {
      startBackfill(db, resolve);
    });

    const after = db.prepare("SELECT embedding FROM contents WHERE body = 'some body'").get() as { embedding: Buffer | null };
    expect(after.embedding).not.toBeNull();
  });

  it("skips rows that already have an embedding", async () => {
    const { isModelReady, getEmbedding } = await import("../../src/embedding/model.js");
    vi.mocked(isModelReady).mockReturnValue(true);

    const db = createTestDb();
    const fakeVec = Buffer.from(new Float32Array(384).fill(0.1).buffer);
    db.exec("INSERT INTO workspaces (name) VALUES ('ws')");
    const { id: wsId } = db.prepare("SELECT id FROM workspaces WHERE name = 'ws'").get() as { id: number };
    db.exec(`INSERT INTO features (workspace_id, name) VALUES (${wsId}, 'ft')`);
    const { id: ftId } = db.prepare("SELECT id FROM features WHERE name = 'ft'").get() as { id: number };
    const { lastInsertRowid } = db.prepare("INSERT INTO contents (type, body, embedding) VALUES ('idea', 'already embedded', ?)").run(fakeVec);
    const contentId = Number(lastInsertRowid);
    db.prepare("INSERT INTO content_features (content_id, feature_id) VALUES (?, ?)").run(contentId, ftId);

    const { startBackfill } = await import("../../src/embedding/backfill.js");
    await new Promise<void>((resolve) => {
      startBackfill(db, resolve);
    });

    // the document vector is not recomputed (its body is never embedded again);
    // only the new section rows get vectors
    expect(vi.mocked(getEmbedding).mock.calls.filter((c) => c[0] === "already embedded").length).toBeLessThanOrEqual(1);
    const row = db.prepare("SELECT embedding FROM contents WHERE id = ?").get(contentId) as { embedding: Buffer };
    expect(Buffer.compare(row.embedding, fakeVec)).toBe(0);
  });

  it("does nothing when model is not ready", async () => {
    const { getEmbedding } = await import("../../src/embedding/model.js");
    const db = createTestDb();
    await createContent(db, "ws", ["ft"], "idea", "needs embedding");

    const { startBackfill } = await import("../../src/embedding/backfill.js");
    await new Promise<void>((resolve) => {
      startBackfill(db, resolve);
    });

    expect(getEmbedding).not.toHaveBeenCalled();
  });

  it("re-sections and embeds docs whose sections lack vectors; does nothing without the model", async () => {
    const { isModelReady, getEmbedding } = await import("../../src/embedding/model.js");
    const db = createTestDb();
    const body = "# 見積\n" + "原価に掛率を乗じる。".repeat(10) + "\n## 端数\n" + "切り捨てとする。".repeat(10);
    await createContent(db, "ws", ["ft"], "doc", body, "T");
    const pending = () => (db.prepare("SELECT count(*) AS n FROM content_chunks WHERE embedding IS NULL").get() as { n: number }).n;
    expect(pending()).toBe(2);

    const { startBackfill } = await import("../../src/embedding/backfill.js");
    await new Promise<void>((resolve) => startBackfill(db, resolve));
    expect(pending()).toBe(2);
    expect(getEmbedding).not.toHaveBeenCalled();

    vi.mocked(isModelReady).mockReturnValue(true);
    await new Promise<void>((resolve) => startBackfill(db, resolve));
    expect(pending()).toBe(0);
    expect((db.prepare("SELECT count(*) AS n FROM vec_chunks").get() as { n: number }).n).toBe(2);
  });
});
