import type Database from "better-sqlite3";
import { getPendingReview, type CommittedReview } from "../db/reviews.js";
import { logInfo } from "../log/logger.js";

const POLL_INTERVAL_MS = 500;

export async function waitForReview(
  db: Database.Database,
  contentId: string,
  timeoutSeconds = 300,
): Promise<CommittedReview> {
  const t0 = Date.now();
  logInfo("wait_for_review", { event: "start", id: contentId, timeout_s: timeoutSeconds });
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const review = getPendingReview(db, contentId);
    if (review) {
      logInfo("wait_for_review", { event: "done", ms: String(Date.now() - t0), status: "committed" });
      return review;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  logInfo("wait_for_review", { event: "done", ms: String(Date.now() - t0), status: "timeout" });
  throw new Error(
    `Review not committed within ${timeoutSeconds}s. ` +
      `When ready, call the /knowledge-base-review skill to process feedback.`,
  );
}
