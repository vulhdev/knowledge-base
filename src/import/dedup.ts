// Duplicate collapsing for branch A (files outside git): identical / superset / FORK per relPath,
// identical content under different paths (alias), and date-suffixed series that get linked.
import { sha256 } from "../text/chunker.js";
import { diffLines } from "../text/line-diff.js";

export type SourceFile = {
  clone: string; // label of the clone the copy came from (e.g. its repository folder name)
  relPath: string; // identity path, clone name already removed
  absPath: string;
  text: string;
  mtimeMs: number;
};

export type Residue = { fromClone: string; fromAbsPath: string; lines: string[] };

export type DedupDoc = {
  relPath: string;
  canonical: SourceFile;
  copies: SourceFile[];
  decision: "single" | "identical" | "superset" | "fork";
  residue?: Residue;
  aliases: { relPath: string; absPath: string }[];
};

export type SeriesLink = { parentRelPath: string; childRelPath: string };

export type DedupResult = { docs: DedupDoc[]; series: SeriesLink[]; log: string[] };

function lines(text: string): string[] {
  return text.split("\n");
}

function byRecency(a: SourceFile, b: SourceFile): number {
  return b.mtimeMs - a.mtimeMs || a.absPath.localeCompare(b.absPath);
}

function collapseSamePath(relPath: string, copies: SourceFile[], log: string[]): DedupDoc {
  if (copies.length === 1) return { relPath, canonical: copies[0], copies, decision: "single", aliases: [] };

  const distinct = new Map<string, SourceFile>();
  for (const c of [...copies].sort(byRecency)) if (!distinct.has(sha256(c.text))) distinct.set(sha256(c.text), c);
  if (distinct.size === 1) {
    const canonical = [...copies].sort(byRecency)[0];
    log.push(`identical  ${relPath}  (${copies.map((c) => c.clone).join(", ")})`);
    return { relPath, canonical, copies, decision: "identical", aliases: [] };
  }

  const variants = [...distinct.values()];
  // A superset has no line the others lack: every other variant only removes lines relative to it.
  const superset = variants.find((v) => variants.every((o) => o === v || diffLines(lines(v.text), lines(o.text)).onlyB.length === 0));
  if (superset) {
    log.push(`superset   ${relPath}  canonical=${superset.clone} (other copies have no line of their own)`);
    return { relPath, canonical: superset, copies, decision: "superset", aliases: [] };
  }

  const canonical = variants[0]; // most recently modified
  const residueLines: string[] = [];
  const others: SourceFile[] = [];
  for (const other of variants.slice(1)) {
    const { onlyB } = diffLines(lines(canonical.text), lines(other.text));
    residueLines.push(...onlyB);
    others.push(other);
  }
  const counts = variants.slice(1).map((o) => {
    const d = diffLines(lines(canonical.text), lines(o.text));
    return `${canonical.clone} only ${d.onlyA.length} / ${o.clone} only ${d.onlyB.length}`;
  });
  log.push(
    `fork       ${relPath}  canonical=${canonical.clone} (latest mtime ${new Date(canonical.mtimeMs).toISOString()}); ` +
      `residue=${residueLines.length} line(s) from ${others.map((o) => o.clone).join(", ")}; ${counts.join("; ")}`,
  );
  return {
    relPath,
    canonical,
    copies,
    decision: "fork",
    residue: { fromClone: others.map((o) => o.clone).join(", "), fromAbsPath: others[0].absPath, lines: residueLines },
    aliases: [],
  };
}

/** Strip date tokens (-YYYYMMDD / _YYYYMMDD) and a trailing .prompt from a file stem. */
export function seriesStem(relPath: string): string {
  const base = relPath.split("/").pop()!.replace(/\.(md|mmd)$/, "");
  return base.replace(/[-_]\d{8}/g, "").replace(/\.prompt$/, "");
}

function dirOf(relPath: string): string {
  const i = relPath.lastIndexOf("/");
  return i < 0 ? "" : relPath.slice(0, i);
}

function sameSeries(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.startsWith(short) && /[_\-.]/.test(long[short.length]);
}

function isDated(relPath: string): boolean {
  return /[-_]\d{8}/.test(relPath.split("/").pop()!);
}

export function dedupFiles(files: SourceFile[]): DedupResult {
  const log: string[] = [];
  const byPath = new Map<string, SourceFile[]>();
  for (const f of files) byPath.set(f.relPath, [...(byPath.get(f.relPath) ?? []), f]);

  let docs = [...byPath.keys()].sort().map((p) => collapseSamePath(p, byPath.get(p)!, log));

  // Alias: different paths whose canonical content is identical line for line (ratio 1.00).
  const bySha = new Map<string, DedupDoc[]>();
  for (const d of docs) bySha.set(sha256(d.canonical.text), [...(bySha.get(sha256(d.canonical.text)) ?? []), d]);
  const dropped = new Set<DedupDoc>();
  for (const group of bySha.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => byRecency(a.canonical, b.canonical));
    const keep = sorted[0];
    for (const other of sorted.slice(1)) {
      keep.aliases.push({ relPath: other.relPath, absPath: other.canonical.absPath }, ...other.aliases);
      dropped.add(other);
      log.push(`alias      ${other.relPath}  ->  ${keep.relPath} (identical content, kept latest mtime)`);
    }
  }
  docs = docs.filter((d) => !dropped.has(d));

  // Series: stems equal, or one a prefix of the other at a _ - . boundary, in the same folder.
  const parent = new Map<string, string>();
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
  for (const d of docs) parent.set(d.relPath, d.relPath);
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i].relPath;
      const b = docs[j].relPath;
      if (dirOf(a) === dirOf(b) && sameSeries(seriesStem(a), seriesStem(b))) parent.set(find(a), find(b));
    }
  }
  const groups = new Map<string, string[]>();
  for (const d of docs) groups.set(find(d.relPath), [...(groups.get(find(d.relPath)) ?? []), d.relPath]);
  const series: SeriesLink[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const head = [...members].sort((a, b) => {
      const dated = Number(isDated(a)) - Number(isDated(b));
      if (dated !== 0) return dated;
      const na = a.split("/").pop()!.length;
      const nb = b.split("/").pop()!.length;
      return na - nb || a.localeCompare(b);
    })[0];
    for (const m of members.sort()) {
      if (m === head) continue;
      series.push({ parentRelPath: head, childRelPath: m });
      log.push(`series     ${head}  ->  ${m}`);
    }
  }

  return { docs, series, log };
}
