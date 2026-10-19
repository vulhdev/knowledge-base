import type { SearchResult } from "../../types.js";
import { layout, typeBadge, esc } from "./_layout.js";

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
    .map((r) => {
      const feat = r.features[0] ?? "";
      return `<tr>
          <td><a href="/ws/${encodeURIComponent(r.workspace)}/${encodeURIComponent(feat)}/${r.id}">${esc(r.title ?? `#${r.id}`)}</a></td>
          <td>${esc(r.workspace)} / ${esc(feat)}</td>
          <td>${typeBadge(r.type)}</td>
        </tr>`;
    })
    .join("\n");
  const body = `${heading}
<table>
  <thead><tr><th>Title</th><th>Location</th><th>Type</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
  return layout(`Search: ${query}`, body, query, workspace);
}
