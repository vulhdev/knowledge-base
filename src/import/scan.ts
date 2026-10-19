// Discover source files and split them into branch A (copy content, dedup) and branch B (SOT
// pointer) by asking git — never by a hard-coded folder list.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { gitRoot, resolveRef, listTrackedAtRef, isIgnored, isTracked, repoId } from "./git.js";
import { relPathFor, cloneOf, isImportableDoc } from "./classify.js";
import type { SourceFile } from "./dedup.js";

export type SotFile = { repoRoot: string; repoId: string; repoPath: string; ref: string; commit: string };

/** A git folder scanned for branch B: cards under it that vanish from the ref are deleted. */
export type SotScope = { repoRoot: string; repoId: string; relDir: string };

export type ScanResult = { aFiles: SourceFile[]; bFiles: SotFile[]; bScopes: SotScope[]; warnings: string[] };

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile()) out.push(p);
  }
  return out.sort();
}

export function scanSources(dirs: string[], opts: { ref?: string } = {}): ScanResult {
  const aFiles: SourceFile[] = [];
  const bFiles: SotFile[] = [];
  const bScopes: SotScope[] = [];
  const warnings: string[] = [];

  for (const d of dirs) {
    const dir = realpathSync(resolve(d));
    const root = gitRoot(dir);
    const onDisk = walk(dir);
    let tracked = new Set<string>();
    let refInfo: { ref: string; commit: string } | null = null;
    const relDir = root ? relative(root, dir).split(sep).join("/") : "";

    if (root) {
      const anyTracked = onDisk.some((p) => isTracked(root, relative(root, p).split(sep).join("/")));
      if (anyTracked) {
        refInfo = resolveRef(root, opts.ref);
        const id = repoId(root, refInfo.commit);
        bScopes.push({ repoRoot: root, repoId: id, relDir });
        tracked = new Set(listTrackedAtRef(root, refInfo.commit, relDir).filter((p) => !isIgnored(root, p)));
        for (const p of [...tracked].sort()) bFiles.push({ repoRoot: root, repoId: id, repoPath: p, ref: refInfo.ref, commit: refInfo.commit });
      }
    }

    for (const abs of onDisk) {
      if (root) {
        const repoPath = relative(root, abs).split(sep).join("/");
        if (tracked.has(repoPath)) continue;
        if (refInfo && !isIgnored(root, repoPath) && isTracked(root, repoPath)) {
          warnings.push(`tracked in the index but not at ${refInfo.ref}: ${repoPath} — skipped`);
          continue;
        }
      }
      const relPath = relPathFor(abs, dir);
      if (!isImportableDoc(relPath)) continue;
      aFiles.push({ clone: cloneOf(abs, dir), relPath, absPath: abs, text: readFileSync(abs, "utf8"), mtimeMs: statSync(abs).mtimeMs });
    }
  }
  return { aFiles, bFiles, bScopes, warnings };
}
