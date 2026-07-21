import type Database from "better-sqlite3";
import { getPendingReview, type CommittedReview } from "../db/reviews.js";

const POLL_INTERVAL_MS = 500;

export async function waitForReview(
  db: Database.Database,
  contentId: number,
  timeoutSeconds = 300,
): Promise<CommittedReview> {
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const review = getPendingReview(db, contentId);
    if (review) return review;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Review not committed within ${timeoutSeconds}s. ` +
      `When ready, call the /knowledge-base-review skill to process feedback.`,
  );
}
