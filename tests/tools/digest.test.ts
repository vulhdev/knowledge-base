import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { updateContent } from "../../src/tools/update-content.js";
import { listContents } from "../../src/tools/list-contents.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("digest type", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("create_content with type='digest' succeeds", async () => {
    const result = await createContent(db, "ws", "ft", "digest", "## TL;DR\nSummary");
    expect(result.type).toBe("digest");
    expect(result.id).toBeTypeOf("number");
  });

  it("creating a second digest for the same feature throws unique constraint error", async () => {
    await createContent(db, "ws", "ft", "digest", "## TL;DR\nFirst digest");
    await expect(
      createContent(db, "ws", "ft", "digest", "## TL;DR\nSecond digest"),
    ).rejects.toThrow();
  });

  it("update_content with type='digest' succeeds", async () => {
    const { id } = await createContent(db, "ws", "ft", "idea", "original idea");
    const updated = updateContent(db, id, "updated body", "digest");
    expect(updated.type).toBe("digest");
  });

  it("list_contents without type filter does not return digest rows", async () => {
    await createContent(db, "ws", "ft", "idea", "an idea");
    await createContent(db, "ws", "ft", "digest", "## TL;DR\nA digest");
    const results = listContents(db, "ws");
    expect(results.every((r) => r.type !== "digest")).toBe(true);
  });

  it("list_contents with type='digest' returns only digest rows", async () => {
    await createContent(db, "ws", "ft", "idea", "an idea");
    await createContent(db, "ws", "ft", "digest", "## TL;DR\nA digest");
    const results = listContents(db, "ws", undefined, "digest");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("digest");
  });

  it("partial unique index does not block digest in a different feature", async () => {
    await createContent(db, "ws", "ft-a", "digest", "## TL;DR\nDigest A");
    await expect(
      createContent(db, "ws", "ft-b", "digest", "## TL;DR\nDigest B"),
    ).resolves.not.toThrow();
  });
});
