import { parse } from "marked";
import type { Workspace } from "../db/workspaces.js";
import type { Feature } from "./db.js";
import type { Content, SearchResult, LineageResult, LinkedContent } from "../types.js";
import type { ErrorLog } from "../db/error-log.js";

const PICO_CDN =
  "https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.classless.min.css";

const CUSTOM_CSS = `
  :root { --pico-font-size: 16px; }
  body { max-width: 1400px; margin-inline: auto; padding-inline: 1.5rem; }
  nav { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  nav a:first-child img { height: 50px; display: block; }
  .breadcrumb { color: var(--pico-muted-color); font-size: 0.9rem; margin-bottom: 0.5rem; }
  .breadcrumb a { color: var(--pico-muted-color); }
  .meta { color: var(--pico-muted-color); font-size: 0.85rem; margin-bottom: 1.5rem; }
  .badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 4px;
           background: var(--pico-secondary-background); font-size: 0.8rem; }
  table td:last-child { white-space: nowrap; }
  .content-body { margin-top: 1.5rem; }
  .content-layout { display: grid; grid-template-columns: 1fr 260px; gap: 2rem; align-items: start; }
  .content-sidebar { border-left: 1px solid var(--pico-muted-border-color); padding-left: 1.5rem; }
  .content-sidebar h4 { margin-bottom: 0.4rem; font-size: 0.9rem; }
  .content-sidebar ul { list-style: none; padding: 0; margin: 0; }
  .content-sidebar li { margin-bottom: 0.5rem; font-size: 0.85rem; }
  .search-form { display: flex; gap: 0.5rem; align-items: flex-end; margin-bottom: 1.5rem; }
  .search-form input { flex: 1; margin: 0; }
  .search-form button { margin: 0; width: auto; }
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
  <link rel="stylesheet" href="${PICO_CDN}" />
  <style>${CUSTOM_CSS}</style>
</head>
<body>
  <header>
    <nav>
      <a href="/"><img src="/assets/kb-lockup-tagline-dark.png" alt="knowledge-base" /></a>
      <a href="/search">Search</a>
      <a href="/errors">Errors</a>
    </nav>
  </header>
  <main>
    ${searchBar(searchQ, searchWs)}
    ${body}
  </main>
</body>
</html>`;
}

export function renderWorkspaceList(workspaces: Workspace[]): string {
  if (workspaces.length === 0) {
    return layout("Workspaces", "<p>No workspaces found. Create content via Claude to get started.</p>");
  }
  const rows = workspaces
    .map(
      (w) =>
        `<tr><td><a href="/ws/${encodeURIComponent(w.name)}">${esc(w.name)}</a></td></tr>`,
    )
    .join("\n");
  const body = `<h2>Workspaces</h2>
<table>
  <thead><tr><th>Name</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
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
          <td><span class="badge">${esc(c.type)}</span></td>
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
  <span class="badge">${esc(content.type)}</span>
  &nbsp; Updated ${formatDate(content.updated_at)}
</p>
<hr />
${contentArea}`;
  return layout(title, body);
}

function renderLinkedSidebar(lineage: LineageResult): string {
  const { ancestors, descendants } = lineage;
  if (ancestors.length === 0 && descendants.length === 0) return "";
  const item = (c: LinkedContent) =>
    `<li><a href="/ws/${encodeURIComponent(c.workspace)}/${encodeURIComponent(c.feature)}/${c.id}">${esc(c.title ?? `#${c.id}`)}</a>
     &nbsp;<span class="badge">${esc(c.type)}</span></li>`;
  const parents = ancestors.length
    ? `<h4>Parents</h4><ul>${ancestors.map(item).join("")}</ul>` : "";
  const children = descendants.length
    ? `<h4>Children</h4><ul>${descendants.map(item).join("")}</ul>` : "";
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
          <td><span class="badge">${esc(r.type)}</span></td>
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
