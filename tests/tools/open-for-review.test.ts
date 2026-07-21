import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { openForReview } from "../../src/tools/open-for-review.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("openForReview", () => {
  let db: Database.Database;
  let contentId: number;

  beforeEach(async () => {
    db = createTestDb();
    const c = await createContent(db, "my-ws", "my-feat", "spec", "body text", "My Spec");
    contentId = c.id;
  });

  it("returns review_id, url and note", () => {
    const result = openForReview(db, contentId);
    expect(result.review_id).toBeTypeOf("number");
    expect(result.url).toContain(`/ws/my-ws/my-feat/${contentId}/review`);
    expect(result.note).toContain("npx @vulhdev/knowledge-base gui");
  });

  it("includes review_id as query param in the url", () => {
    const result = openForReview(db, contentId);
    expect(result.url).toContain(`review_id=${result.review_id}`);
  });

  it("throws when content_id does not exist", () => {
    expect(() => openForReview(db, 9999)).toThrow(/Content not found/);
  });

  it("creates a new review each call (multiple allowed)", () => {
    const r1 = openForReview(db, contentId);
    const r2 = openForReview(db, contentId);
    expect(r2.review_id).toBeGreaterThan(r1.review_id);
  });
});
