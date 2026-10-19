import { diffLines } from "diff";
import type { Content, VersionSummary } from "../../types.js";
import { layout, esc, formatDate } from "./_layout.js";

export function renderDiff(
  from: Content,
  to: Content,
  allVersions: VersionSummary[],
): string {
  const workspace = from.workspace;
  const primaryFeature = from.features[0] ?? "";
  const rootId = from.root_id ?? from.id;
  const title = from.title ?? `#${rootId}`;

  const crumb = `<p class="breadcrumb">
    <a href="/">Home</a> /
    <a href="/ws/${encodeURIComponent(workspace)}">${esc(workspace)}</a> /
    <a href="/ws/${encodeURIComponent(workspace)}/${encodeURIComponent(primaryFeature)}">${esc(primaryFeature)}</a> /
    <a href="/ws/${encodeURIComponent(workspace)}/${encodeURIComponent(primaryFeature)}/${rootId}">${esc(title)}</a> /
    Diff
  </p>`;

  const diffBase = `/ws/${encodeURIComponent(workspace)}/${encodeURIComponent(primaryFeature)}/${rootId}/diff`;
  const versionOptions = (selectedId: number) =>
    allVersions
      .map(
        (v) =>
          `<option value="${v.id}"${v.id === selectedId ? " selected" : ""}>v${v.version_number}${v.is_latest ? " (latest)" : ""} — ${formatDate(v.created_at)}</option>`,
      )
      .join("");

  const versionBar = `<div class="diff-version-bar">
    <span>Compare</span>
    <form method="get" action="${diffBase}" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <select name="from">${versionOptions(from.id)}</select>
      <span>→</span>
      <select name="to">${versionOptions(to.id)}</select>
      <button type="submit">Compare</button>
    </form>
  </div>`;

  const fromBody = from.body.replace(/\r\n/g, "\n");
  const toBody = to.body.replace(/\r\n/g, "\n");
  const changes = diffLines(fromBody, toBody);

  let oldLine = 1;
  let newLine = 1;
  const rows: string[] = [];
  let hasChanges = false;

  for (const change of changes) {
    const lines = change.value.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();

    if (change.removed) {
      hasChanges = true;
      for (const line of lines) {
        rows.push(`<tr class="diff-line-del"><td class="ln">${oldLine++}</td><td class="ln"></td><td class="diff-sign">-</td><td>${esc(line)}</td></tr>`);
      }
    } else if (change.added) {
      hasChanges = true;
      for (const line of lines) {
        rows.push(`<tr class="diff-line-add"><td class="ln"></td><td class="ln">${newLine++}</td><td class="diff-sign">+</td><td>${esc(line)}</td></tr>`);
      }
    } else {
      for (const line of lines) {
        rows.push(`<tr class="diff-line-ctx"><td class="ln">${oldLine++}</td><td class="ln">${newLine++}</td><td class="diff-sign"> </td><td>${esc(line)}</td></tr>`);
      }
    }
  }

  const diffTable = !hasChanges
    ? `<p style="color:#8b949e;margin-top:24px">No differences between these versions.</p>`
    : `<table class="diff-table"><tbody>${rows.join("")}</tbody></table>`;

  const body = `${crumb}
<h1>${esc(title)} — v${from.version_number} → v${to.version_number}</h1>
<p class="meta"><span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#8b949e">v${from.version_number}: ${formatDate(from.created_at)} &nbsp;→&nbsp; v${to.version_number}: ${formatDate(to.created_at)}</span></p>
<hr />
${versionBar}
${diffTable}`;

  return layout(`${esc(title)} — v${from.version_number} → v${to.version_number}`, body);
}
