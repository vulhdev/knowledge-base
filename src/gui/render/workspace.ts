import type { WorkspaceSummary, RecentContent } from "../db.js";
import { layout, typeBadge, esc, formatDate, relativeTime } from "./_layout.js";

export function renderWorkspaceList(workspaces: WorkspaceSummary[], recent: RecentContent[] = []): string {
  const hero = `<div class="hero">
    <h1>Find answers across your workspace.</h1>
  </div>`;
  if (workspaces.length === 0) {
    return layout("Workspaces", hero + "<p>No workspaces found. Create content via Claude to get started.</p>");
  }
  const cards = workspaces
    .map((w) => {
      const count = `${w.feature_count} feature${w.feature_count !== 1 ? "s" : ""}`;
      const updated = w.last_updated ? `· Updated ${formatDate(w.last_updated)}` : "";
      return `<a href="/ws/${encodeURIComponent(w.name)}" class="workspace-card">
        <span class="workspace-card-name">${esc(w.name)}</span>
        <span class="workspace-card-meta">${esc(count)} ${esc(updated)}</span>
      </a>`;
    })
    .join("\n");
  const body = `${hero}<div class="workspace-grid">${cards}</div>${renderRecentSection(recent)}`;
  return layout("Workspaces", body);
}

export function renderRecentSection(recent: RecentContent[]): string {
  if (recent.length === 0) return "";
  const rows = recent
    .map((r) => {
      const href = `/ws/${encodeURIComponent(r.workspace)}/${encodeURIComponent(r.feature)}/${r.id}`;
      const label = r.title ?? `#${r.id}`;
      return `<li class="recent-row">
        <span class="recent-left">
          ${typeBadge(r.type)}
          <a href="${href}">${esc(label)}</a>
          <span class="recent-path">${esc(r.workspace)} / ${esc(r.feature)}</span>
        </span>
        <span class="recent-age">${relativeTime(r.touched_at)}</span>
      </li>`;
    })
    .join("\n");
  return `<section class="recent-section">
  <span class="section-label">Recently Updated</span>
  <ul class="recent-list">${rows}</ul>
</section>`;
}
