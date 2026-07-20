import { parse } from "marked";
import type { Feature, WorkspaceSummary } from "./db.js";
import type { Content, SearchResult, LineageResult, LinkedContent } from "../types.js";
import type { ErrorLog } from "../db/error-log.js";

const GOOGLE_FONTS =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap";

const CUSTOM_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 16px; line-height: 24px;
    background: #0b141c; color: #dae3ee;
    max-width: 1280px; margin-inline: auto;
    padding-inline: 24px; padding-block: 24px;
  }
  a { color: #d2bbff; text-decoration: none; }
  a:hover { color: #ffffff; }
  h1 { font-size: 28px; font-weight: 600; line-height: 36px; letter-spacing: -0.01em; margin-bottom: 16px; }
  h2 { font-size: 20px; font-weight: 600; line-height: 28px; margin-bottom: 12px; }
  h3 { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
  p { margin-bottom: 12px; }
  ul, ol { padding-left: 1.5rem; margin-bottom: 12px; }
  hr { border: none; border-top: 1px solid #2d363e; margin-block: 24px; }
  code { font-family: 'JetBrains Mono', monospace; font-size: 13px; background: #141c24; padding: 1px 5px; border-radius: 4px; }
  pre { background: #060f16; border: 1px solid #2d363e; border-radius: 8px; padding: 16px; overflow-x: auto; margin-bottom: 16px; }
  pre code { background: none; padding: 0; font-size: 14px; line-height: 22px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { text-align: left; font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 500; color: #8b949e; text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 12px; border-bottom: 1px solid #2d363e; }
  td { padding: 12px; border-bottom: 1px solid #2d363e; font-size: 14px; }
  td:last-child { white-space: nowrap; }
  tr:hover td { background: #141c24; }
  .nav { display: flex; align-items: center; border-bottom: 1px solid #2d363e; margin-bottom: 32px; padding-bottom: 0; }
  .nav-brand { font-weight: 600; color: #dae3ee; padding-right: 24px; font-size: 15px; text-decoration: none; }
  .nav-brand:hover { color: #ffffff; }
  .nav a.nav-link { padding: 12px 16px; font-size: 14px; color: #8b949e; border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .nav a.nav-link:hover { color: #dae3ee; }
  .breadcrumb { font-size: 13px; color: #8b949e; margin-bottom: 16px; }
  .breadcrumb a { color: #8b949e; }
  .breadcrumb a:hover { color: #d2bbff; }
  .meta { font-size: 13px; color: #8b949e; margin-bottom: 24px; display: flex; align-items: center; gap: 8px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #ffffff; background: #41474f; }
  .search-form { display: flex; gap: 8px; margin-bottom: 24px; }
  .search-form input { flex: 1; background: #141c24; border: 1px solid #2d363e; border-radius: 8px; padding: 10px 14px; color: #dae3ee; font-size: 14px; font-family: inherit; }
  .search-form input:focus { outline: none; border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,0.2); }
  .search-form button { background: #7c3aed; color: #ffffff; border: none; border-radius: 8px; padding: 10px 20px; cursor: pointer; font-size: 14px; font-family: inherit; }
  .search-form button:hover { background: #6d28d9; }
  .content-body { min-width: 0; }
  .content-body pre { overflow-x: auto; }
  .content-body table { display: block; overflow-x: auto; }
  .content-layout { display: grid; grid-template-columns: 1fr 260px; gap: 32px; align-items: start; margin-top: 24px; }
  .content-sidebar { border-left: 1px solid #2d363e; padding-left: 24px; }
  .content-sidebar .section-label { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: #8b949e; text-transform: uppercase; margin-bottom: 8px; display: block; }
  .content-sidebar ul { list-style: none; padding: 0; margin: 0 0 20px 0; }
  .content-sidebar li { display: block; margin-bottom: 8px; font-size: 13px; }
  .content-sidebar li .badge { font-size: 11px; padding: 1px 6px; }
  .content-sidebar li a { display: inline; color: #d2bbff; }
  .hero { text-align: center; padding-block: 40px 32px; }
  .hero h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 20px; }
  .workspace-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 8px; }
  @media (max-width: 768px) { .workspace-grid { grid-template-columns: 1fr; } }
  .workspace-card { background: #141c24; border: 1px solid #2d363e; border-radius: 8px; padding: 20px; display: flex; flex-direction: column; gap: 6px; transition: border-color 0.15s; }
  .workspace-card:hover { border-color: #7c3aed; }
  .workspace-card-name { font-weight: 600; font-size: 15px; color: #dae3ee; }
  .workspace-card-meta { font-size: 12px; color: #8b949e; }
`;

function searchBar(defaultQ = "", defaultWs = ""): string {
  return `
    <form class="search-form" method="get" action="/search">
      <input name="q" type="search" placeholder="Search…" value="${esc(defaultQ)}" />
      ${defaultWs ? `<input type="hidden" name="workspace" value="${esc(defaultWs)}" />` : ""}
      <button type="submit">Search</button>
    </form>`;
}

export function layout(title: string, body: string, searchQ = "", searchWs = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} — knowledge-base</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="${GOOGLE_FONTS}" />
  <style>${CUSTOM_CSS}</style>
</head>
<body>
  <header>
    <nav class="nav">
      <a href="/" class="nav-brand">knowledge-base</a>
      <a href="/search" class="nav-link">Search</a>
      <a href="/errors" class="nav-link">Errors</a>
    </nav>
  </header>
  <main>
    ${searchBar(searchQ, searchWs)}
    ${body}
  </main>
</body>
</html>`;
}

export function renderWorkspaceList(workspaces: WorkspaceSummary[]): string {
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
  const body = `${hero}<div class="workspace-grid">${cards}</div>`;
  return layout("Workspaces", body);
}

export function renderFeatureList(workspace: string, features: Feature[]): string {
  const crumb = `<p class="breadcrumb"><a href="/">Home</a> / ${esc(workspace)}</p>`;
  if (features.length === 0) {
    return layout(workspace, crumb + "<p>No features in this workspace.</p>");
  }
  const rows = features
    .map(
      (f) =>
        `<tr><td><a href="/ws/${encodeURIComponent(workspace)}/${encodeURIComponent(f.name)}">${esc(f.name)}</a></td></tr>`,
    )
    .join("\n");
  const body = `${crumb}<h2>${esc(workspace)}</h2>
<table>
  <thead><tr><th>Feature</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
  return layout(workspace, body);
}

export function renderContentList(
  workspace: string,
  feature: string,
  contents: Content[],
): string {
  const crumb = `<p class="breadcrumb">
    <a href="/">Home</a> /
    <a href="/ws/${encodeURIComponent(workspace)}">${esc(workspace)}</a> /
    ${esc(feature)}
  </p>`;
  if (contents.length === 0) {
    return layout(`${workspace}/${feature}`, crumb + "<p>No contents in this feature.</p>");
  }
  const rows = contents
    .map(
      (c) =>
        `<tr>
          <td><a href="/ws/${encodeURIComponent(workspace)}/${encodeURIComponent(feature)}/${c.id}">${esc(c.title ?? `#${c.id}`)}</a></td>
          <td>${typeBadge(c.type)}</td>
          <td>${formatDate(c.updated_at)}</td>
        </tr>`,
    )
    .join("\n");
  const body = `${crumb}<h2>${esc(workspace)} / ${esc(feature)}</h2>
<table>
  <thead><tr><th>Title</th><th>Type</th><th>Updated</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
  return layout(`${workspace}/${feature}`, body);
}

export function renderContent(content: Content, lineage?: LineageResult): string {
  const crumb = `<p class="breadcrumb">
    <a href="/">Home</a> /
    <a href="/ws/${encodeURIComponent(content.workspace)}">${esc(content.workspace)}</a> /
    <a href="/ws/${encodeURIComponent(content.workspace)}/${encodeURIComponent(content.feature)}">${esc(content.feature)}</a> /
    #${content.id}
  </p>`;
  const title = content.title ?? `#${content.id}`;
  const renderedBody = parse(content.body) as string;
  const sidebar = lineage ? renderLinkedSidebar(lineage) : "";
  const mainContent = `<div class="content-body">${renderedBody}</div>`;
  const contentArea = sidebar
    ? `<div class="content-layout">${mainContent}${sidebar}</div>`
    : mainContent;
  const body = `${crumb}
<h1>${esc(title)}</h1>
<p class="meta">
  ${typeBadge(content.type)}
  &nbsp; Updated ${formatDate(content.updated_at)}
</p>
<hr />
${contentArea}`;
  return layout(title, body);
}

function typeBadge(type: string): string {
  const colors: Record<string, string> = {
    spec: "#7c3aed",
    plan: "#a15100",
    idea: "#1d4ed8",
  };
  const bg = colors[type] ?? "#41474f";
  return `<span class="badge" style="background:${bg}">${esc(type)}</span>`;
}

function renderLinkedSidebar(lineage: LineageResult): string {
  const { ancestors, descendants } = lineage;
  if (ancestors.length === 0 && descendants.length === 0) return "";
  const item = (c: LinkedContent) =>
    `<li>${typeBadge(c.type)}&nbsp;<a href="/ws/${encodeURIComponent(c.workspace)}/${encodeURIComponent(c.feature)}/${c.id}">${esc(c.title ?? `#${c.id}`)}</a></li>`;
  const parents = ancestors.length
    ? `<span class="section-label">PARENTS</span><ul>${ancestors.map(item).join("")}</ul>` : "";
  const children = descendants.length
    ? `<span class="section-label">CHILDREN</span><ul>${descendants.map(item).join("")}</ul>` : "";
  return `<aside class="content-sidebar">${parents}${children}</aside>`;
}

export function renderSearchResults(
  query: string,
  results: SearchResult[],
  workspace?: string,
): string {
  const heading = `<h2>Search: <em>${esc(query)}</em>${workspace ? ` in <strong>${esc(workspace)}</strong>` : ""}</h2>`;
  if (results.length === 0) {
    return layout(`Search: ${query}`, heading + "<p>No results found.</p>", query, workspace);
  }
  const rows = results
    .map(
      (r) =>
        `<tr>
          <td><a href="/ws/${encodeURIComponent(r.workspace)}/${encodeURIComponent(r.feature)}/${r.id}">${esc(r.title ?? `#${r.id}`)}</a></td>
          <td>${esc(r.workspace)} / ${esc(r.feature)}</td>
          <td>${typeBadge(r.type)}</td>
        </tr>`,
    )
    .join("\n");
  const body = `${heading}
<table>
  <thead><tr><th>Title</th><th>Location</th><th>Type</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
  return layout(`Search: ${query}`, body, query, workspace);
}

export function renderErrorList(errors: ErrorLog[]): string {
  if (errors.length === 0) {
    return layout("Errors", "<p>No errors recorded.</p>");
  }
  const rows = errors
    .map(
      (e) =>
        `<tr>
          <td>${esc(e.timestamp)}</td>
          <td><span class="badge">${esc(e.tool_name)}</span></td>
          <td>${esc(e.message)}</td>
        </tr>`,
    )
    .join("\n");
  const body = `<h2>Error Log</h2>
<table>
  <thead><tr><th>Timestamp</th><th>Tool</th><th>Message</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
  return layout("Errors", body);
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
