import type Database from "better-sqlite3";
import { createReview } from "../db/reviews.js";
import { getContent } from "./get-content.js";
import { logInfo } from "../log/logger.js";

export interface OpenForReviewResult {
  review_id: number;
  url: string;
  note: string;
}

export function openForReview(
  db: Database.Database,
  contentId: string,
  port = 57891,
): OpenForReviewResult {
  const t0 = Date.now();
  logInfo("open_for_review", { event: "start", id: contentId });
  const content = getContent(db, contentId);
  const review = createReview(db, contentId);

  const ws = encodeURIComponent(content.workspace);
  const url = `http://localhost:${port}/ws/${ws}/doc/${contentId}/review?review_id=${review.id}`;

  logInfo("open_for_review", { event: "done", ms: String(Date.now() - t0), review_id: review.id, gui_url: url });
  return {
    review_id: review.id,
    url,
    note: "Start GUI server first: npx @vulhdev/knowledge-base gui",
  };
}
