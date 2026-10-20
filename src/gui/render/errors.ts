import type { ErrorLog } from "../../db/error-log.js";
import { layout, esc } from "./_layout.js";

export function renderErrorList(errors: ErrorLog[]): string {
  const header = `<h1>Error Log</h1>
<p class="page-subtitle">MCP tool errors recorded in the last 1000 entries</p>`;
  if (errors.length === 0) {
    return layout("Errors", header + `<div class="empty-state">✓ No errors recorded.</div>`);
  }
  const rows = errors
    .map(
      (e) =>
        `<tr>
          <td><span class="ts">${esc(e.timestamp)}</span></td>
          <td><span class="tool-chip">${esc(e.tool_name)}</span></td>
          <td><span class="severity-error">${esc(e.severity)}</span></td>
          <td class="msg">${esc(e.message)}</td>
        </tr>`,
    )
    .join("\n");
  const body = `${header}
<table>
  <thead><tr><th>Timestamp</th><th>Tool</th><th>Severity</th><th>Message</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
  return layout("Errors", body);
}
