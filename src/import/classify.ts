// Classification of imported files: identity path, workspace keys, type, features and title.
import { basename, relative, sep } from "node:path";

const MARKER = `${sep}.claude${sep}claude${sep}`;

/** Identity path: the part under `.claude/claude/` (clone name dropped), else relative to the source dir. */
export function relPathFor(absPath: string, sourceDir: string): string {
  const i = absPath.indexOf(MARKER);
  const rel = i >= 0 ? absPath.slice(i + MARKER.length) : relative(sourceDir, absPath);
  return rel.split(sep).join("/");
}

/** Label of the clone a file came from: the folder holding `.claude/claude`, else the source dir name. */
export function cloneOf(absPath: string, sourceDir: string): string {
  const i = absPath.indexOf(MARKER);
  return i >= 0 ? basename(absPath.slice(0, i)) : basename(sourceDir);
}

export const docSourceKey = (ws: string, relPath: string) => `doc:${ws}:${relPath}`;
export const residueSourceKey = (ws: string, relPath: string) => `doc:${ws}:${relPath}#fork-residue`;
export const cardSourceKey = (sotWs: string, repoPath: string) => `sot:${sotWs}:${repoPath}`;

const EXCLUDE: RegExp[] = [
  /(^|\/)compacts\//,
  /(^|\/)scratch\//,
  /(^|\/)chain\/.*\/steps\//,
  /(^|\/)chain\/.*\/payload-[^/]*$/,
  /\.jsonl$/,
  /(^|\/)contract\.json$/,
  /(^|\/)testcmd$/,
  /(^|\/)backups\//,
  /(^|\/)scripts\//,
  /(^|\/)\.cc-writes\//,
  /(^|\/)\.DS_Store$/,
  /(^|\/)\.start-day-feec$/,
];

/** Branch A accepts .md and .mmd only, minus the exclusion list. */
export function isImportableDoc(relPath: string): boolean {
  if (!/\.(md|mmd)$/i.test(relPath)) return false;
  return !EXCLUDE.some((re) => re.test(relPath));
}

const TECHNICAL_DIR = /^(steps|checklists|contracts|eval|runs)$|-\d{12}$/;

const STAGE_TYPE: Record<string, string> = {
  analyze: "analyze",
  specs: "spec",
  plans: "plan",
  pipeline: "pipeline",
  implemented: "implemented",
  prompts: "prompt",
  verification: "verification",
  decisions: "decision",
  issues: "issue",
  docs: "doc",
  "harness-agentic-SDLC": "doc",
  "branch-digest": "doc",
  chain: "chain",
};

function typeFor(relPath: string): string {
  const name = relPath.split("/").pop()!;
  const stage = relPath.split("/")[0];
  if (/^docs\/reports\/.*\.report\.md$/.test(relPath)) return "report";
  if (/\.analyze\.md$/.test(name)) return "analyze";
  if (/\.spec(\.prompt)?\.md$/.test(name)) return "spec";
  if (/\.plan\.prompt\.md$/.test(name)) return "plan";
  if (/\.pipeline\.md$/.test(name)) return "pipeline";
  if (/\.implt(\.prompt)?\.md$/.test(name)) return "implemented";
  if (/\.vrf\.prompt\.md$/.test(name)) return "verification";
  if (STAGE_TYPE[stage]) return STAGE_TYPE[stage];
  if (/\.(prompt|runbook)\.md$/.test(name)) return "prompt";
  return "doc";
}

function featuresFor(relPath: string): string[] {
  const parts = relPath.split("/");
  const stage = parts[0];
  const name = parts[parts.length - 1];
  const lane = /\.(fe|be|fs)\.[^/]*$/.exec(name)?.[1];
  const extra = lane ? [`lane:${lane}`] : [];
  if (stage === "docs" || stage === "harness-agentic-SDLC" || stage === "branch-digest") {
    return [parts[1] === "reports" ? "_reports" : "_project-docs", ...extra];
  }
  const dirs = parts.slice(1, -1).filter((d) => !TECHNICAL_DIR.test(d));
  if (dirs.length === 0) {
    const stem = name.replace(/\.(md|mmd)$/, "").replace(/\.(analyze|spec|plan|pipeline|implt|prompt|runbook|vrf|report|fe|be|fs)\b/g, "").replace(/\.+$/, "");
    return [stem || name, ...extra];
  }
  const out = [dirs[0]];
  if (dirs.length > 1) out.push(dirs[dirs.length - 1]);
  return [...new Set([...out, ...extra])];
}

function titleFor(relPath: string, text: string): string {
  const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(text);
  if (h1) return h1[1].trim();
  return relPath.split("/").pop()!.replace(/\.(md|mmd)$/i, "");
}

export type DocClass = { type: string; features: string[]; title: string; body: string };

export function classifyDoc(relPath: string, text: string): DocClass {
  const body = /\.mmd$/i.test(relPath) ? "```mermaid\n" + text.replace(/\n$/, "") + "\n```\n" : text;
  return { type: typeFor(relPath), features: featuresFor(relPath), title: titleFor(relPath, text), body };
}

export type CardClass = { type: string; features: string[]; title: string };

export function classifyCard(repoPath: string, text: string): CardClass {
  const name = repoPath.split("/").pop()!;
  const parentDir = repoPath.split("/").slice(-2, -1)[0];
  const flow = /^(F-\d{3})-/.exec(name)?.[1];
  const type = /^F-\d{3}-status\.md$/.test(name) ? "sot-status" : /^F-\d{3}-.*\.md$/.test(name) ? "sot-spec" : "sot-file";
  const features = [...(flow ? [flow] : []), ...(parentDir ? [parentDir] : ["_root"])];
  const h1 = /\.md$/i.test(name) ? /^#\s+(.+?)\s*#*\s*$/m.exec(text)?.[1].trim() : undefined;
  return { type, features, title: h1 ? `${name} · ${h1}` : name };
}
