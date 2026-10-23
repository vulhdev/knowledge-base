import { parse } from "marked";
import type { Content, LineageResult, LinkedContent, VersionSummary } from "../../types.js";
import { layout, typeBadge, esc, formatDate } from "./_layout.js";

export function renderContent(
  content: Content,
  lineage?: LineageResult,
  versions?: VersionSummary[],
): string {
  const primaryFeature = content.features[0] ?? "";
  const crumb = `<p class="breadcrumb">
    <a href="/">Home</a> /
    <a href="/ws/${encodeURIComponent(content.workspace)}">${esc(content.workspace)}</a> /
    <a href="/ws/${encodeURIComponent(content.workspace)}/${encodeURIComponent(primaryFeature)}">${esc(primaryFeature)}</a> /
    #${content.id}
  </p>`;
  const title = content.title ?? `#${content.id}`;
  const renderedBody = parse(content.body) as string;

  const versionWidget =
    versions && versions.length >= 2
      ? renderVersionWidget(content, versions, primaryFeature)
      : "";

  const linkedSidebar = lineage ? renderLinkedSidebar(lineage) : "";
  const sidebar = versionWidget || linkedSidebar
    ? `<aside class="content-sidebar">${versionWidget}${linkedSidebar.replace(/^<aside[^>]*>|<\/aside>$/g, "")}</aside>`
    : "";
  const mainContent = `<div class="content-body">${renderedBody}</div>`;
  const contentArea = sidebar
    ? `<div class="content-layout">${mainContent}${sidebar}</div>`
    : mainContent;

  const exportUrl = `/ws/${encodeURIComponent(content.workspace)}/${encodeURIComponent(primaryFeature)}/${content.id}/export`;
  const escapedBody = JSON.stringify(content.body);
  const copyScript = `(function(b){navigator.clipboard.writeText(b).then(function(){var el=document.getElementById('copy-btn-${content.id}');el.textContent='Copied!';setTimeout(function(){el.textContent='Copy';},2000);})})(${escapedBody})`;
  const actions = `<span class="action-btns">
  <a class="action-btn" href="${exportUrl}">↓ Export .md</a>
  <button id="copy-btn-${content.id}" class="action-btn" onclick="${esc(copyScript)}">Copy</button>
</span>`;
  const body = `${crumb}
<h1>${esc(title)}</h1>
<p class="meta">
  <span>${typeBadge(content.type)}&nbsp; Updated ${formatDate(content.updated_at)}</span>
  ${actions}
</p>
<hr />
${contentArea}`;
  return layout(title, body);
}

function renderVersionWidget(
  content: Content,
  versions: VersionSummary[],
  primaryFeature: string,
): string {
  const rootId = content.root_id ?? content.id;
  const diffBase = `/ws/${encodeURIComponent(content.workspace)}/${encodeURIComponent(primaryFeature)}/${rootId}/diff`;
  const latest = versions.find((v) => v.is_latest) ?? versions[versions.length - 1];
  const secondLatest = versions[versions.indexOf(latest) - 1] ?? versions[0];

  const options = versions
    .map(
      (v) =>
        `<option value="${v.id}"${v.id === secondLatest.id ? " selected" : ""}>v${v.version_number}${v.is_latest ? " (latest)" : ""}</option>`,
    )
    .join("");
  const toOptions = versions
    .map(
      (v) =>
        `<option value="${v.id}"${v.id === latest.id ? " selected" : ""}>v${v.version_number}${v.is_latest ? " (latest)" : ""}</option>`,
    )
    .join("");

  return `<span class="section-label">VERSIONS</span>
<form method="get" action="${diffBase}" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
  <select name="from" style="background:#0b141c;border:1px solid #2d363e;border-radius:4px;padding:4px 6px;color:#dae3ee;font-family:'JetBrains Mono',monospace;font-size:11px">${options}</select>
  <select name="to" style="background:#0b141c;border:1px solid #2d363e;border-radius:4px;padding:4px 6px;color:#dae3ee;font-family:'JetBrains Mono',monospace;font-size:11px">${toOptions}</select>
  <button type="submit" style="background:#7c3aed;color:#fff;border:none;border-radius:4px;padding:5px 10px;cursor:pointer;font-size:12px;font-family:inherit">Compare</button>
</form>
<a href="${diffBase}" style="font-size:12px;color:#8b949e">What changed?</a>`;
}

function renderLinkedSidebar(lineage: LineageResult): string {
  const { ancestors, descendants } = lineage;
  if (ancestors.length === 0 && descendants.length === 0) return "";
  const item = (c: LinkedContent) =>
    `<li>${typeBadge(c.type)}&nbsp;<a href="/ws/${encodeURIComponent(c.workspace)}/${encodeURIComponent(c.features[0] ?? "")}/${c.id}">${esc(c.title ?? `#${c.id}`)}</a></li>`;
  const parents = ancestors.length
    ? `<span class="section-label">PARENTS</span><ul>${ancestors.map(item).join("")}</ul>` : "";
  const children = descendants.length
    ? `<span class="section-label">CHILDREN</span><ul>${descendants.map(item).join("")}</ul>` : "";
  return `<aside class="content-sidebar">${parents}${children}</aside>`;
}
