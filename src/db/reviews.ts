import type Database from "better-sqlite3";

export interface Review {
  id: number;
  content_id: number;
  status: string;
  created_at: string;
  committed_at: string | null;
}

export interface ReviewComment {
  id: number;
  review_id: number;
  selected_text: string | null;
  comment: string;
  created_at: string;
}

export interface CommittedReview extends Review {
  comments: ReviewComment[];
}

export interface ContentWithReview {
  id: number;
  title: string | null;
  workspace: string;
  feature: string;
  type: string;
}

export function createReview(db: Database.Database, contentId: number): Review {
  const exists = db.prepare("SELECT id FROM contents WHERE id = ?").get(contentId);
  if (!exists) throw new Error(`Content not found: id=${contentId}`);

  return db
    .prepare(
      `INSERT INTO reviews (content_id) VALUES (?)
       RETURNING id, content_id, status, created_at, committed_at`,
    )
    .get(contentId) as Review;
}

export function addComment(
  db: Database.Database,
  reviewId: number,
  comment: string,
  selectedText?: string,
): ReviewComment {
  const exists = db.prepare("SELECT id FROM reviews WHERE id = ?").get(reviewId);
  if (!exists) throw new Error(`Review not found: id=${reviewId}`);

  return db
    .prepare(
      `INSERT INTO review_comments (review_id, comment, selected_text) VALUES (?, ?, ?)
       RETURNING id, review_id, selected_text, comment, created_at`,
    )
    .get(reviewId, comment, selectedText ?? null) as ReviewComment;
}

export function commitReview(db: Database.Database, reviewId: number): CommittedReview {
  const review = db
    .prepare(
      `UPDATE reviews SET status = 'committed', committed_at = datetime('now')
       WHERE id = ?
       RETURNING id, content_id, status, created_at, committed_at`,
    )
    .get(reviewId) as Review | undefined;

  if (!review) throw new Error(`Review not found: id=${reviewId}`);

  const comments = db
    .prepare("SELECT id, review_id, selected_text, comment, created_at FROM review_comments WHERE review_id = ? ORDER BY id")
    .all(reviewId) as ReviewComment[];

  return { ...review, comments };
}

export function getPendingReview(db: Database.Database, contentId: number): CommittedReview | null {
  const review = db
    .prepare(
      `SELECT id, content_id, status, created_at, committed_at FROM reviews
       WHERE content_id = ? AND status = 'committed'
       ORDER BY committed_at DESC, id DESC LIMIT 1`,
    )
    .get(contentId) as Review | undefined;

  if (!review) return null;

  const comments = db
    .prepare("SELECT id, review_id, selected_text, comment, created_at FROM review_comments WHERE review_id = ? ORDER BY id")
    .all(review.id) as ReviewComment[];

  return { ...review, comments };
}

export function listContentsWithPendingReview(db: Database.Database): ContentWithReview[] {
  return db
    .prepare(
      `SELECT DISTINCT c.id, c.title, c.type, w.name AS workspace, f.name AS feature
       FROM contents c
       JOIN features f ON f.id = c.feature_id
       JOIN workspaces w ON w.id = f.workspace_id
       JOIN reviews r ON r.content_id = c.id
       WHERE r.status = 'committed'
       ORDER BY r.committed_at DESC`,
    )
    .all() as ContentWithReview[];
}
