import type Database from "better-sqlite3";
import { getPendingReview, type CommittedReview } from "../db/reviews.js";
import { logInfo } from "../log/logger.js";

export function getPendingReviewTool(db: Database.Database, contentId: string): CommittedReview {
  const t0 = Date.now();
  logInfo("get_pending_review", { event: "start", id: contentId });
  const review = getPendingReview(db, contentId);
  if (!review) {
    throw new Error(`No committed review found for content_id=${contentId}`);
  }
  logInfo("get_pending_review", { event: "done", ms: String(Date.now() - t0), review_id: review.id });
  return review;
}
