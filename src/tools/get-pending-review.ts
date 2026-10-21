import type Database from "better-sqlite3";
import { getPendingReview, type CommittedReview } from "../db/reviews.js";

export function getPendingReviewTool(db: Database.Database, contentId: string): CommittedReview {
  const review = getPendingReview(db, contentId);
  if (!review) {
    throw new Error(`No committed review found for content_id=${contentId}`);
  }
  return review;
}
