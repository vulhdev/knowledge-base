import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { appendContent } from "../../src/tools/append-content.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("appendContent", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("appends text with newline separator when body does not end with \\n", async () => {
    const created = await createContent(db, "proj", ["auth"], "idea", "existing body");
    const result = await appendContent(db, created.id, "new line");
    expect(result.body).toBe("existing body\nnew line");
  });

  it("appends text directly when body already ends with \\n (no double newline)", async () => {
    const created = await createContent(db, "proj", ["auth"], "idea", "existing body\n");
    const result = await appendContent(db, created.id, "new line");
    expect(result.body).toBe("existing body\nnew line");
  });

  it("returns full Content object with correct fields", async () => {
    const created = await createContent(db, "proj", ["docs"], "plan", "initial content");
    const result = await appendContent(db, created.id, "appended");
    expect(result.id).toBe(created.id);
    expect(result.workspace).toBe("proj");
    expect(result.features).toEqual(["docs"]);
    expect(result.type).toBe("plan");
  });

  it("preserves created_at and updates updated_at", async () => {
    const created = await createContent(db, "proj", ["auth"], "idea", "body");
    const result = await appendContent(db, created.id, "more");
    expect(result.created_at).toBe(created.created_at);
    expect(result.updated_at).toBeTruthy();
  });

  it("throws 'text must not be empty' for blank text", async () => {
    const created = await createContent(db, "proj", ["auth"], "idea", "body");
    await expect(appendContent(db, created.id, "")).rejects.toThrow("text must not be empty");
    await expect(appendContent(db, created.id, "   ")).rejects.toThrow("text must not be empty");
  });

  it("throws 'Content not found' for unknown id", async () => {
    await expect(appendContent(db, 999, "text")).rejects.toThrow("Content not found: id=999");
  });

  it("FTS reflects appended content", async () => {
    const created = await createContent(db, "proj", ["auth"], "idea", "initial content here");
    await appendContent(db, created.id, "uniqueword betafox");
    const match = db
      .prepare("SELECT rowid FROM contents_fts WHERE contents_fts MATCH ?")
      .all("betafox");
    expect(match).toHaveLength(1);
  });

  it("embedding is updated when model is ready", async () => {
    const { isModelReady, getEmbedding } = await import("../../src/embedding/model.js");
    vi.mocked(isModelReady).mockReturnValue(true);
    vi.mocked(getEmbedding).mockResolvedValue(new Float32Array(384).fill(0.5));

    const created = await createContent(db, "proj", ["auth"], "idea", "body text");
    await appendContent(db, created.id, "appended text");
    expect(vi.mocked(getEmbedding)).toHaveBeenCalled();

    vi.mocked(isModelReady).mockReturnValue(false);
  });

  it("embedding failure does not prevent body update", async () => {
    const { isModelReady, getEmbedding } = await import("../../src/embedding/model.js");
    vi.mocked(isModelReady).mockReturnValue(true);
    vi.mocked(getEmbedding).mockRejectedValue(new Error("model crash"));

    const created = await createContent(db, "proj", ["auth"], "idea", "body");
    const result = await appendContent(db, created.id, "appended safely");
    expect(result.body).toBe("body\nappended safely");

    vi.mocked(isModelReady).mockReturnValue(false);
  });

  it("handles multiline append correctly", async () => {
    const body = "## Log\n\n- Entry one";
    const created = await createContent(db, "proj", ["docs"], "doc", body);
    const result = await appendContent(db, created.id, "- Entry two");
    expect(result.body).toBe("## Log\n\n- Entry one\n- Entry two");
  });
});
