import { describe, it, expect, beforeEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { updateContent } from "../../src/tools/update-content.js";
import { listContents } from "../../src/tools/list-contents.js";

describe("digest type", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  it("create_content with type='digest' succeeds", () => {
    const result = createContent(db, "ws", "ft", "digest", "## TL;DR\nSummary");
    expect(result.type).toBe("digest");
    expect(result.id).toBeTypeOf("number");
  });

  it("creating a second digest for the same feature throws unique constraint error", () => {
    createContent(db, "ws", "ft", "digest", "## TL;DR\nFirst digest");
    expect(() =>
      createContent(db, "ws", "ft", "digest", "## TL;DR\nSecond digest"),
    ).toThrow();
  });

  it("update_content with type='digest' succeeds", () => {
    const { id } = createContent(db, "ws", "ft", "idea", "original idea");
    const updated = updateContent(db, id, "updated body", "digest");
    expect(updated.type).toBe("digest");
  });

  it("list_contents without type filter does not return digest rows", () => {
    createContent(db, "ws", "ft", "idea", "an idea");
    createContent(db, "ws", "ft", "digest", "## TL;DR\nA digest");
    const results = listContents(db, "ws");
    expect(results.every((r) => r.type !== "digest")).toBe(true);
  });

  it("list_contents with type='digest' returns only digest rows", () => {
    createContent(db, "ws", "ft", "idea", "an idea");
    createContent(db, "ws", "ft", "digest", "## TL;DR\nA digest");
    const results = listContents(db, "ws", undefined, "digest");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("digest");
  });

  it("partial unique index does not block digest in a different feature", () => {
    createContent(db, "ws", "ft-a", "digest", "## TL;DR\nDigest A");
    expect(() =>
      createContent(db, "ws", "ft-b", "digest", "## TL;DR\nDigest B"),
    ).not.toThrow();
  });
});
