// Load plan: the single description of what an import writes. The importer applies it; the
// baseline loader feeds the same plan to the old code, so both runs see the same data.
import { sha256, outlineMarkdown } from "../text/chunker.js";
import { showAtCommit, fileHistory } from "./git.js";
import { dedupFiles } from "./dedup.js";
import { classifyDoc, classifyCard, docSourceKey, residueSourceKey, cardSourceKey } from "./classify.js";
import type { ScanResult } from "./scan.js";

export type PlanDoc = {
  kind: "doc" | "residue";
  source_key: string;
  workspace: string;
  features: string[];
  type: string;
  title: string;
  body: string;
  source_sha: string;
};

export type PlanCard = {
  kind: "card";
  source_key: string;
  workspace: string;
  features: string[];
  type: string;
  title: string;
  body: string;
  source_sha: string; // sha256 of the file content at `commit`
  repo_root: string;
  repo_path: string;
  ref: string;
  commit: string; // last commit that changed the file, reachable from `ref`
  ref_commit: string; // the commit `ref` resolved to when the plan was built
  markdown: boolean;
};

export type PlanLink = { parent_source_key: string; child_source_key: string; reason: "fork-residue" | "series" };

export type LoadPlan = {
  version: 1;
  workspace: string;
  sot_workspace: string;
  items: (PlanDoc | PlanCard)[];
  links: PlanLink[];
  /** source_key prefixes of every scanned SOT folder: cards under them that are not in `items` are removed */
  sot_scopes: string[];
  /** cards that exist at the ref but could not be planned this run: never pruned */
  skipped_keys: string[];
  log: string[];
  warnings: string[];
  stats: { files_a: number; files_b: number; docs: number; residues: number; cards: number; aliases: number; series_links: number };
};

export type CardInput = {
  repoRoot: string;
  repoPath: string;
  ref: string;
  commit: string;
  sha: string;
  text: string;
  history: { hash: string; date: string }[];
};

/** Card body: where the file is and how to read it, its heading outline and its history. Never the content. */
export function buildCardBody(c: CardInput): string {
  const out = [
    `# ${c.repoPath.split("/").pop()}`,
    "",
    `- path: \`${c.repoPath}\``,
    `- ref: \`${c.ref}\``,
    `- commit: \`${c.commit}\``,
    `- sha256: \`${c.sha}\``,
    `- read: \`git -C ${c.repoRoot} show ${c.commit}:${c.repoPath}\``,
    "",
    "## Outline",
    "",
  ];
  const outline = /\.md$/i.test(c.repoPath) ? outlineMarkdown(c.text) : [];
  if (outline.length === 0) out.push(`- L1–L${c.text.split("\n").length} (no headings)`);
  for (const e of outline) out.push(`- L${e.start_line}–L${e.end_line} ${e.key} ${e.heading}`);
  out.push("", "## History", "");
  for (const h of c.history) out.push(`- ${h.hash} ${h.date}`);
  return out.join("\n") + "\n";
}

export function buildLoadPlan(scan: ScanResult, workspace: string, sotWorkspace: string): LoadPlan {
  const { docs, series, log } = dedupFiles(scan.aFiles);
  const items: (PlanDoc | PlanCard)[] = [];
  const links: PlanLink[] = [];
  const keyOf = new Map<string, string>();
  let docCount = 0, residueCount = 0, cardCount = 0;

  for (const d of docs) {
    const cls = classifyDoc(d.relPath, d.canonical.text);
    const key = docSourceKey(workspace, d.relPath);
    keyOf.set(d.relPath, key);
    items.push({ kind: "doc", source_key: key, workspace, features: cls.features, type: cls.type, title: cls.title, body: cls.body, source_sha: sha256(cls.body) });
    docCount++;
    if (d.residue) {
      const body = d.residue.lines.join("\n") + "\n";
      const rkey = residueSourceKey(workspace, d.relPath);
      items.push({
        kind: "residue",
        source_key: rkey,
        workspace,
        features: cls.features,
        type: "fork-residue",
        title: `${cls.title} (fork residue: ${d.residue.fromClone})`,
        body,
        source_sha: sha256(body),
      });
      residueCount++;
      links.push({ parent_source_key: key, child_source_key: rkey, reason: "fork-residue" });
    }
  }
  for (const s of series) {
    links.push({ parent_source_key: keyOf.get(s.parentRelPath)!, child_source_key: keyOf.get(s.childRelPath)!, reason: "series" });
  }

  const warnings = [...scan.warnings];
  const skipped: string[] = [];
  const cardKeys = new Set<string>();
  for (const b of scan.bFiles) {
    const key = cardSourceKey(sotWorkspace, b.repoId, b.repoPath);
    if (cardKeys.has(key)) {
      warnings.push(`duplicate SOT key ${key} (${b.repoRoot}) — the same repository and path was already planned; skipped`);
      continue;
    }
    cardKeys.add(key);
    try {
      const history = fileHistory(b.repoRoot, b.commit, b.repoPath);
      const commit = history[0]?.hash ?? b.commit;
      const text = showAtCommit(b.repoRoot, commit, b.repoPath);
      if (text.includes("\u0000")) {
        warnings.push(`binary SOT file skipped: ${b.repoPath}`);
        skipped.push(key);
        continue;
      }
      const sha = sha256(text);
      const cls = classifyCard(b.repoPath, text);
      items.push({
        kind: "card",
        source_key: key,
        workspace: sotWorkspace,
        features: cls.features,
        type: cls.type,
        title: cls.title,
        body: buildCardBody({ repoRoot: b.repoRoot, repoPath: b.repoPath, ref: b.ref, commit, sha, text, history }),
        source_sha: sha,
        repo_root: b.repoRoot,
        repo_path: b.repoPath,
        ref: b.ref,
        commit,
        ref_commit: b.commit,
        markdown: /\.md$/i.test(b.repoPath),
      });
      cardCount++;
    } catch (err) {
      warnings.push(`SOT file ${b.repoPath}: ${(err as Error).message}`);
      skipped.push(key);
    }
  }

  return {
    version: 1,
    workspace,
    sot_workspace: sotWorkspace,
    items,
    links,
    sot_scopes: scan.bScopes.map((sc) => cardSourceKey(sotWorkspace, sc.repoId, sc.relDir ? `${sc.relDir}/` : "")),
    skipped_keys: skipped,
    log,
    warnings,
    stats: {
      files_a: scan.aFiles.length,
      files_b: scan.bFiles.length,
      docs: docCount,
      residues: residueCount,
      cards: cardCount,
      aliases: docs.reduce((n, d) => n + d.aliases.length, 0),
      series_links: series.length,
    },
  };
}
