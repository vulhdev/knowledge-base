import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { patchContent } from "../../src/tools/patch-content.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("patchContent", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("replaces a unique substring and returns full Content object", async () => {
    const created = await createContent(db, "proj", ["auth"], "idea", "hello world foo");
    const result = await patchContent(db, created.id, "world", "earth");
    expect(result.body).toBe("hello earth foo");
    expect(result.id).toBe(created.id);
    expect(result.workspace).toBe("proj");
    expect(result.features).toEqual(["auth"]);
    expect(result.type).toBe("idea");
  });

  it("preserves created_at and updates updated_at", async () => {
    const created = await createContent(db, "proj", ["auth"], "idea", "original text");
    const result = await patchContent(db, created.id, "original", "modified");
    expect(result.created_at).toBe(created.created_at);
    expect(result.updated_at).toBeTruthy();
  });

  it("throws 'String not found' when old_string is absent", async () => {
    const created = await createContent(db, "proj", ["auth"], "idea", "hello world");
    await expect(patchContent(db, created.id, "nothere", "x")).rejects.toThrow(
      "String not found in document body",
    );
  });

  it("throws 'Ambiguous match' when multiple occurrences and replace_all=false", async () => {
    const created = await createContent(db, "proj", ["auth"], "idea", "foo bar foo baz foo");
    await expect(patchContent(db, created.id, "foo", "qux")).rejects.toThrow(
      "Ambiguous match: 3 occurrences found. Provide more context in old_string, or set replace_all=true.",
    );
  });

  it("replaces all occurrences when replace_all=true", async () => {
    const created = await createContent(db, "proj", ["auth"], "idea", "foo bar foo baz foo");
    const result = await patchContent(db, created.id, "foo", "qux", true);
    expect(result.body).toBe("qux bar qux baz qux");
  });

  it("throws 'Content not found' for unknown id", async () => {
    await expect(patchContent(db, 999, "x", "y")).rejects.toThrow("Content not found: id=999");
  });

  it("allows new_string to be empty (delete a substring)", async () => {
    const created = await createContent(db, "proj", ["auth"], "idea", "hello world");
    const result = await patchContent(db, created.id, " world", "");
    expect(result.body).toBe("hello");
  });

  it("FTS reflects new body after patch", async () => {
    const created = await createContent(db, "proj", ["auth"], "idea", "old keyword alphazulu");
    await patchContent(db, created.id, "alphazulu", "betafox");
    const oldMatch = db
      .prepare("SELECT rowid FROM contents_fts WHERE contents_fts MATCH ?")
      .all("alphazulu");
    const newMatch = db
      .prepare("SELECT rowid FROM contents_fts WHERE contents_fts MATCH ?")
      .all("betafox");
    expect(oldMatch).toHaveLength(0);
    expect(newMatch).toHaveLength(1);
  });

  it("embedding is updated when model is ready", async () => {
    const { isModelReady, getEmbedding } = await import("../../src/embedding/model.js");
    vi.mocked(isModelReady).mockReturnValue(true);
    vi.mocked(getEmbedding).mockResolvedValue(new Float32Array(384).fill(0.5));

    const created = await createContent(db, "proj", ["auth"], "idea", "original text here");
    await patchContent(db, created.id, "original", "updated");
    expect(vi.mocked(getEmbedding)).toHaveBeenCalled();

    vi.mocked(isModelReady).mockReturnValue(false);
  });

  it("embedding failure does not prevent body update", async () => {
    const { isModelReady, getEmbedding } = await import("../../src/embedding/model.js");
    vi.mocked(isModelReady).mockReturnValue(true);
    vi.mocked(getEmbedding).mockRejectedValue(new Error("model crash"));

    const created = await createContent(db, "proj", ["auth"], "idea", "safe text here");
    const result = await patchContent(db, created.id, "safe", "updated");
    expect(result.body).toBe("updated text here");

    vi.mocked(isModelReady).mockReturnValue(false);
  });

  it("handles multiline body patch correctly", async () => {
    const body = "## Title\n\n- [ ] Task one\n- [ ] Task two\n- [ ] Task three";
    const created = await createContent(db, "proj", ["docs"], "plan", body);
    const result = await patchContent(db, created.id, "- [ ] Task two", "- [x] Task two");
    expect(result.body).toBe("## Title\n\n- [ ] Task one\n- [x] Task two\n- [ ] Task three");
  });
});
