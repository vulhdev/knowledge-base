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
    await createContent(db, "ws", "ft", "idea", "some body");
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
    db.prepare("INSERT INTO contents (feature_id, type, body, embedding) VALUES (?, 'idea', 'already embedded', ?)").run(ftId, fakeVec);

    const { startBackfill } = await import("../../src/embedding/backfill.js");
    await new Promise<void>((resolve) => {
      startBackfill(db, resolve);
    });

    expect(getEmbedding).not.toHaveBeenCalled();
  });

  it("does nothing when model is not ready", async () => {
    const { getEmbedding } = await import("../../src/embedding/model.js");
    const db = createTestDb();
    await createContent(db, "ws", "ft", "idea", "needs embedding");

    const { startBackfill } = await import("../../src/embedding/backfill.js");
    await new Promise<void>((resolve) => {
      startBackfill(db, resolve);
    });

    expect(getEmbedding).not.toHaveBeenCalled();
  });
});
