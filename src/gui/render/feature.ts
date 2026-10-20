import type { Feature } from "../db.js";
import type { Content } from "../../types.js";
import { layout, typeBadge, esc, formatDate } from "./_layout.js";

export function renderFeatureList(workspace: string, features: Feature[], hasTeam = false): string {
  const crumb = `<p class="breadcrumb"><a href="/">Home</a> / ${esc(workspace)}</p>`;
  const teamLink = hasTeam
    ? ` <a href="/ws/${encodeURIComponent(workspace)}/team" class="team-link">Team →</a>`
    : "";
  if (features.length === 0) {
    return layout(workspace, crumb + `<h2>${esc(workspace)}${teamLink}</h2>` + "<p>No features in this workspace.</p>");
  }
  const rows = features
    .map(
      (f) =>
        `<tr><td><a href="/ws/${encodeURIComponent(workspace)}/${encodeURIComponent(f.name)}">${esc(f.name)}</a></td></tr>`,
    )
    .join("\n");
  const body = `${crumb}<h2>${esc(workspace)}${teamLink}</h2>
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
