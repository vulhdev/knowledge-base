import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { createReview, addComment, commitReview } from "../../src/db/reviews.js";
import { getPendingReviewTool } from "../../src/tools/get-pending-review.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("getPendingReviewTool", () => {
  let db: Database.Database;
  let contentId: number;

  beforeEach(async () => {
    db = createTestDb();
    const c = await createContent(db, "ws", "feat", "spec", "body");
    contentId = c.id;
  });

  it("throws when no committed review exists", () => {
    expect(() => getPendingReviewTool(db, contentId)).toThrow(
      /No committed review found for content_id=/,
    );
  });

  it("throws when only pending review exists", () => {
    createReview(db, contentId);
    expect(() => getPendingReviewTool(db, contentId)).toThrow(
      /No committed review found for content_id=/,
    );
  });

  it("returns committed review with comments", () => {
    const r = createReview(db, contentId);
    addComment(db, r.id, "expand this section", "some text");
    addComment(db, r.id, "general note");
    commitReview(db, r.id);

    const result = getPendingReviewTool(db, contentId);
    expect(result.status).toBe("committed");
    expect(result.committed_at).toBeTruthy();
    expect(result.comments).toHaveLength(2);
    expect(result.comments[0].selected_text).toBe("some text");
    expect(result.comments[1].selected_text).toBeNull();
  });
});
