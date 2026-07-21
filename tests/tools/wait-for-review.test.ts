import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { createReview, addComment, commitReview } from "../../src/db/reviews.js";
import { waitForReview } from "../../src/tools/wait-for-review.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("waitForReview", () => {
  let db: Database.Database;
  let contentId: number;

  beforeEach(async () => {
    db = createTestDb();
    const c = await createContent(db, "ws", "feat", "spec", "body");
    contentId = c.id;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns immediately when review is already committed", async () => {
    const r = createReview(db, contentId);
    addComment(db, r.id, "great spec", "some text");
    commitReview(db, r.id);

    const result = await waitForReview(db, contentId, 5);
    expect(result.status).toBe("committed");
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].comment).toBe("great spec");
  });

  it("throws timeout error when review is never committed", async () => {
    createReview(db, contentId);

    await expect(waitForReview(db, contentId, 0.001)).rejects.toThrow(
      /Review not committed within/,
    );
  });

  it("timeout error message mentions knowledge-base-review skill", async () => {
    createReview(db, contentId);

    await expect(waitForReview(db, contentId, 0.001)).rejects.toThrow(
      /knowledge-base-review/,
    );
  });

  it("picks up review committed during polling", async () => {
    const r = createReview(db, contentId);
    addComment(db, r.id, "inline comment");

    // Commit after a short delay (simulated by committing before awaiting)
    const waitPromise = waitForReview(db, contentId, 5);
    commitReview(db, r.id);

    const result = await waitPromise;
    expect(result.status).toBe("committed");
    expect(result.comments[0].comment).toBe("inline comment");
  });
});
