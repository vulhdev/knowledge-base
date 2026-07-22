import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import {
  createReview,
  addComment,
  commitReview,
  getPendingReview,
  listContentsWithPendingReview,
} from "../../src/db/reviews.js";

async function seedContent(db: Database.Database): Promise<number> {
  db.exec("INSERT OR IGNORE INTO workspaces (name) VALUES ('ws')");
  const { id: wsId } = db.prepare("SELECT id FROM workspaces WHERE name = 'ws'").get() as { id: number };
  db.exec(`INSERT OR IGNORE INTO features (workspace_id, name) VALUES (${wsId}, 'ft')`);
  const { id: ftId } = db.prepare("SELECT id FROM features WHERE name = 'ft'").get() as { id: number };
  db.prepare("INSERT INTO contents (feature_id, type, title, body) VALUES (?, 'spec', 'My Spec', 'body text')").run(ftId);
  const { id } = db.prepare("SELECT id FROM contents ORDER BY id DESC LIMIT 1").get() as { id: number };
  return id;
}

describe("createReview", () => {
  let db: Database.Database;
  let contentId: number;

  beforeEach(async () => {
    db = createTestDb();
    contentId = await seedContent(db);
  });

  it("creates a review with status=pending", () => {
    const review = createReview(db, contentId);
    expect(review.content_id).toBe(contentId);
    expect(review.status).toBe("pending");
    expect(review.id).toBeTypeOf("number");
    expect(review.created_at).toBeTruthy();
  });

  it("throws when content_id does not exist", () => {
    expect(() => createReview(db, 9999)).toThrow(/Content not found/);
  });

  it("allows multiple reviews for the same content", () => {
    createReview(db, contentId);
    const r2 = createReview(db, contentId);
    expect(r2.content_id).toBe(contentId);
  });
});

describe("addComment", () => {
  let db: Database.Database;
  let reviewId: number;

  beforeEach(async () => {
    db = createTestDb();
    const contentId = await seedContent(db);
    reviewId = createReview(db, contentId).id;
  });

  it("adds a comment with selected_text", () => {
    const c = addComment(db, reviewId, "needs more detail", "some text");
    expect(c.review_id).toBe(reviewId);
    expect(c.comment).toBe("needs more detail");
    expect(c.selected_text).toBe("some text");
  });

  it("adds a comment without selected_text (null)", () => {
    const c = addComment(db, reviewId, "general comment");
    expect(c.selected_text).toBeNull();
  });

  it("throws when review_id does not exist", () => {
    expect(() => addComment(db, 9999, "comment")).toThrow(/Review not found/);
  });
});

describe("commitReview", () => {
  let db: Database.Database;
  let reviewId: number;

  beforeEach(async () => {
    db = createTestDb();
    const contentId = await seedContent(db);
    reviewId = createReview(db, contentId).id;
    addComment(db, reviewId, "fix this", "highlighted text");
    addComment(db, reviewId, "expand here");
  });

  it("sets status to committed and fills committed_at", () => {
    const result = commitReview(db, reviewId);
    expect(result.status).toBe("committed");
    expect(result.committed_at).toBeTruthy();
  });

  it("returns all comments", () => {
    const result = commitReview(db, reviewId);
    expect(result.comments).toHaveLength(2);
    expect(result.comments[0].comment).toBe("fix this");
    expect(result.comments[0].selected_text).toBe("highlighted text");
    expect(result.comments[1].selected_text).toBeNull();
  });

  it("throws when review_id does not exist", () => {
    expect(() => commitReview(db, 9999)).toThrow(/Review not found/);
  });
});

describe("getPendingReview", () => {
  let db: Database.Database;
  let contentId: number;

  beforeEach(async () => {
    db = createTestDb();
    contentId = await seedContent(db);
  });

  it("returns null when no committed review exists", () => {
    expect(getPendingReview(db, contentId)).toBeNull();
  });

  it("returns null when only a pending review exists", () => {
    createReview(db, contentId);
    expect(getPendingReview(db, contentId)).toBeNull();
  });

  it("returns committed review with comments", () => {
    const r = createReview(db, contentId);
    addComment(db, r.id, "looks good", "text");
    commitReview(db, r.id);

    const result = getPendingReview(db, contentId);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("committed");
    expect(result!.comments).toHaveLength(1);
    expect(result!.comments[0].comment).toBe("looks good");
  });

  it("returns most recent committed review when multiple exist", () => {
    const r1 = createReview(db, contentId);
    addComment(db, r1.id, "first review");
    commitReview(db, r1.id);

    const r2 = createReview(db, contentId);
    addComment(db, r2.id, "second review");
    commitReview(db, r2.id);

    const result = getPendingReview(db, contentId);
    expect(result!.comments[0].comment).toBe("second review");
  });
});

describe("listContentsWithPendingReview", () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = createTestDb();
  });

  it("returns empty array when no committed reviews exist", async () => {
    expect(listContentsWithPendingReview(db)).toEqual([]);
  });

  it("returns contents that have committed reviews", async () => {
    const id1 = await seedContent(db);
    const id2 = await seedContent(db);

    const r1 = createReview(db, id1);
    commitReview(db, r1.id);

    createReview(db, id2); // pending, not committed

    const results = listContentsWithPendingReview(db);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(id1);
    expect(results[0].title).toBe("My Spec");
    expect(results[0].workspace).toBe("ws");
    expect(results[0].feature).toBe("ft");
  });
});
