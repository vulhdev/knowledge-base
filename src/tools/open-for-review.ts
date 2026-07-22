import type Database from "better-sqlite3";
import { createReview } from "../db/reviews.js";
import { getContent } from "./get-content.js";

export interface OpenForReviewResult {
  review_id: number;
  url: string;
  note: string;
}

export function openForReview(
  db: Database.Database,
  contentId: number,
  port = 3000,
): OpenForReviewResult {
  const content = getContent(db, contentId);
  const review = createReview(db, contentId);

  const ws = encodeURIComponent(content.workspace);
  const feat = encodeURIComponent(content.feature);
  const url = `http://localhost:${port}/ws/${ws}/${feat}/${contentId}/review?review_id=${review.id}`;

  return {
    review_id: review.id,
    url,
    note: "Start GUI server first: npx @vulhdev/knowledge-base gui",
  };
}
