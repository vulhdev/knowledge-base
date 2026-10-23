import { layout, esc } from "./_layout.js";

export function renderErrorList(lines: string[]): string {
  const header = `<h1>Error Log</h1>
<p class="page-subtitle">Last 500 log entries from disk</p>`;
  if (lines.length === 0) {
    return layout("Errors", header + `<div class="empty-state">✓ No log entries found.</div>`);
  }
  const body = `${header}
<pre class="log-pre">${esc(lines.join("\n"))}</pre>`;
  return layout("Errors", body);
}
