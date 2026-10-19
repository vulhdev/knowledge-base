import { parse } from "marked";
import type { Content } from "../../types.js";
import type { ReviewComment } from "../../db/reviews.js";
import { layout, typeBadge, esc, formatDate } from "./_layout.js";

export function renderReview(
  content: Content,
  reviewId: number,
  comments: ReviewComment[] = [],
): string {
  const primaryFeat = content.features[0] ?? "";
  const crumb = `<p class="breadcrumb">
    <a href="/">Home</a> /
    <a href="/ws/${encodeURIComponent(content.workspace)}">${esc(content.workspace)}</a> /
    <a href="/ws/${encodeURIComponent(content.workspace)}/${encodeURIComponent(primaryFeat)}">${esc(primaryFeat)}</a> /
    <a href="/ws/${encodeURIComponent(content.workspace)}/${encodeURIComponent(primaryFeat)}/${content.id}">#${content.id}</a> /
    Review
  </p>`;
  const title = content.title ?? `#${content.id}`;
  const renderedBody = parse(content.body) as string;
  const commentsBasePath = `/ws/${encodeURIComponent(content.workspace)}/${encodeURIComponent(primaryFeat)}/${content.id}/review/${reviewId}`;

  const commentItems = comments.length
    ? comments
        .map(
          (c) => `<li class="review-comment-item${c.resolved_at ? " review-comment-resolved" : ""}">
            ${c.resolved_at ? `<span class="review-resolved-badge">✓ Resolved</span>` : ""}
            ${c.selected_text ? `<blockquote class="review-quote">${esc(c.selected_text)}</blockquote>` : ""}
            <p class="review-comment-text">${esc(c.comment)}</p>
            <p class="review-comment-ts">${formatDate(c.created_at)}</p>
          </li>`,
        )
        .join("")
    : `<li class="review-comment-empty">No comments yet.<br>Select text above to add one.</li>`;

  const sidebar = `<aside class="review-sidebar">
    <span class="section-label">Comments</span>
    <ul id="review-comment-list" class="review-comment-list">${commentItems}</ul>
    <button id="commit-btn" class="action-btn review-commit-btn" data-path="${esc(commentsBasePath)}">
      ✓ Commit Review
    </button>
  </aside>`;

  const popup = `<div id="comment-popup" class="review-popup" style="display:none">
    <textarea id="comment-input" class="review-popup-input" placeholder="Add a comment…" rows="3"></textarea>
    <div class="review-popup-actions">
      <button id="comment-submit" class="action-btn">Add</button>
      <button id="comment-cancel" class="action-btn">Cancel</button>
    </div>
  </div>`;

  const body = `${crumb}
<h1>${esc(title)} — Review</h1>
<p class="meta"><span>${typeBadge(content.type)}&nbsp; Reviewing #${content.id}</span></p>
<hr />
<link rel="stylesheet" href="/assets/review.css" />
${popup}
<div class="review-layout">
  <div id="content-body" class="content-body">${renderedBody}</div>
  ${sidebar}
</div>
<script>window.__reviewBasePath = ${JSON.stringify(commentsBasePath)};</script>
<script src="/assets/review.js"></script>`;

  return layout(`Review: ${title}`, body);
}
