// R-Q1 harness: run the frozen golden set against a test DB with a given KB source tree.
//   node --import tsx src/eval/run.ts --db <path> --golden <jsonl> --freeze <json> --kb-src <tree>
//        --label <baseline|after> --out <dir> [--sot-repo <path>] [--baseline <results.json>]
//        [--import-json <first-import.json>] [--import2-json <second-import.json>] [--real-db-before <file>]
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { loadGolden, GROUPS, GoldenHashMismatch, type GoldenQuestion, type Freeze } from "./golden.js";
import { aggregate, noAnswerRatio, percentile, rankOf, resolveKey, sectionHit, versionHit, type GroupMetrics, type QuestionOutcome } from "./metrics.js";
import { loadKb, openWith } from "./kb-src.js";
import { sotWindows, scanDb } from "./sc005.js";
import { assertNotRealDb } from "../db/client.js";

type Args = {
  db: string; golden: string; freeze: string; kbSrc: string; label: string; out: string;
  sotRepo?: string; baseline?: string; importJson?: string; import2Json?: string; realDbBefore?: string;
};

function parse(argv: string[]): Args {
  const get = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const need = (n: string) => { const v = get(n); if (!v) throw new Error(`${n} is required`); return v; };
  return {
    db: need("--db"), golden: need("--golden"), freeze: need("--freeze"), kbSrc: need("--kb-src"), label: need("--label"), out: need("--out"),
    sotRepo: get("--sot-repo"), baseline: get("--baseline"), importJson: get("--import-json"), import2Json: get("--import2-json"), realDbBefore: get("--real-db-before"),
  };
}

const REAL_DB = join(homedir(), ".claude", "knowledge-base", "knowledge-base.db");
function realDbStat(): string {
  try {
    const s = statSync(REAL_DB);
    return `${Math.floor(s.mtimeMs / 1000)} ${s.size}`;
  } catch {
    return "absent";
  }
}

const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const git = (repo: string, args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

function cardCommit(body: string): string | null {
  return /^- commit: `([0-9a-f]{40})`/m.exec(body)?.[1] ?? null;
}
function cardHistory(body: string): string[] {
  const i = body.indexOf("## History");
  if (i < 0) return [];
  return [...body.slice(i).matchAll(/^- ([0-9a-f]{40}) /gm)].map((m) => m[1]);
}

export type RunResult = {
  label: string; kb_src: string; kb_commit: string; sot_commit: string | null; golden_sha256: string; frozen_at: string;
  db: string; db_bytes: number; import_ms: number | null; groups: GroupMetrics[]; no_answer_ratio: number | null;
  pointer: { checked: number; ok: number } | null; query_ms: { p50: number | null; p95: number | null };
  outcomes: (QuestionOutcome & { query: string; top: string[]; unresolved?: string[] })[];
  sc005: { matches: number; samples: unknown[] } | null;
  real_db: { before: string | null; after: string };
  missing_embeddings: { docs: number; sections: number };
};

export async function runHarness(a: Args): Promise<{ code: number; result?: RunResult; message?: string }> {
  let golden;
  try {
    golden = loadGolden(a.golden, a.freeze);
  } catch (err) {
    if (err instanceof GoldenHashMismatch) return { code: 3, message: err.message };
    throw err;
  }
  if (golden.problems.length) return { code: 3, message: `golden set invalid: ${golden.problems.join("; ")}` };
  assertNotRealDb(a.db);
  const before = a.realDbBefore && existsSync(a.realDbBefore) ? readFileSync(a.realDbBefore, "utf8").trim() : realDbStat();

  const kb = await loadKb(resolve(a.kbSrc));
  const db = openWith(kb, a.db);
  const hasCol = (t: string, c: string) => (db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info(?) WHERE name = ?").get(t, c) as { n: number }).n > 0;
  const hasTable = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t);
  const after = hasCol("contents", "source_key");

  const missingDocs = (db.prepare("SELECT COUNT(*) AS n FROM contents WHERE embedding IS NULL").get() as { n: number }).n;
  const missingSections = hasTable("content_chunks") ? (db.prepare("SELECT COUNT(*) AS n FROM content_chunks WHERE embedding IS NULL").get() as { n: number }).n : 0;
  if (missingDocs > 0 || (a.label !== "baseline" && missingSections > 0)) {
    db.close();
    return { code: 4, message: `refusing to conclude: ${missingDocs} doc(s) and ${missingSections} section/pointer(s) lack embeddings` };
  }

  // id <-> source_key
  const keyOf = new Map<number, string>();
  if (after) for (const r of db.prepare("SELECT id, source_key FROM contents WHERE source_key IS NOT NULL").all() as { id: number; source_key: string }[]) keyOf.set(r.id, r.source_key);
  else for (const [k, id] of Object.entries(JSON.parse(readFileSync(`${a.db}.id-map.json`, "utf8")) as Record<string, number>)) keyOf.set(id, k);
  const idOf = new Map([...keyOf].map(([id, k]) => [k, id]));
  const bodyOf = (id: number) => (db.prepare("SELECT body FROM contents WHERE id = ?").get(id) as { body: string } | undefined)?.body ?? "";

  const outcomes: RunResult["outcomes"] = [];
  let pointerChecked = 0;
  let pointerOk = 0;
  const pointerSeen = new Set<string>();
  const sotText = new Map<string, string>();
  const chunkSha = after && hasTable("content_chunks") ? db.prepare("SELECT chunk_sha FROM content_chunks WHERE content_id = ? AND kind = 'sot' AND chunk_key = ?") : null;

  for (const q of golden.questions as GoldenQuestion[]) {
    const t0 = performance.now();
    const page = await kb.searchSemantic(db, q.query, q.workspace ?? undefined, undefined, 10, 0);
    const ms = performance.now() - t0;
    const ids = page.results.map((r) => r.id);
    const unresolved: string[] = [];
    const relevant = new Set<number>();
    for (const k of q.expect ? (q.expect.any_of ?? [q.expect.source_key!]) : []) {
      const key = resolveKey(k, idOf.keys());
      if (key) relevant.add(idOf.get(key)!);
      else unresolved.push(k);
    }
    const rank = q.expect ? rankOf(ids, relevant) : null;
    const hit = rank !== null ? page.results[rank - 1] : undefined;

    let sHit: boolean | null = null;
    if (a.label !== "baseline" && q.expect && (q.expect.sections?.length || q.expect.anchor)) {
      const matched = hit?.matched_sections ?? [];
      if (q.expect.anchor) {
        const lines = hit ? bodyOf(hit.id).split("\n") : [];
        const at = lines.flatMap((l, i) => (l.includes(q.expect!.anchor!) ? [i + 1] : []));
        sHit = at.length === 1 ? sectionHit(matched, [{ start_line: at[0], end_line: at[0] }]) : false;
      } else if (q.expect.commit_relation === "history") {
        // expected lines are at an older commit; compare the heading the answer lives under instead
        const heads = q.expect.sections!.map((s) => s.heading_path.split(" › ").pop()!);
        sHit = matched.some((m) => heads.some((h) => m.heading_path.includes(h)));
      } else {
        sHit = sectionHit(matched, q.expect.sections!);
      }
    }

    let vHit: boolean | null = null;
    if (a.label !== "baseline" && q.expect?.commit_relation && q.expect.commit) {
      vHit = hit && rank! <= 5 ? versionHit(q.expect.commit_relation, q.expect.commit, cardCommit(hit.body), cardHistory(hit.body)) : false;
    }

    if (a.sotRepo && chunkSha) {
      for (const r of page.results) {
        for (const m of r.matched_sections ?? []) {
          if (!m.source_path || !m.source_commit) continue;
          const tag = `${r.id}|${m.chunk_key}`;
          if (pointerSeen.has(tag)) continue;
          pointerSeen.add(tag);
          pointerChecked++;
          const fileKey = `${m.source_commit}:${m.source_path}`;
          if (!sotText.has(fileKey)) sotText.set(fileKey, git(a.sotRepo, ["show", fileKey]));
          const slice = sotText.get(fileKey)!.split("\n").slice(m.start_line - 1, m.end_line).join("\n");
          const row = chunkSha.get(r.id, m.chunk_key.slice(m.chunk_key.lastIndexOf("#") + 1)) as { chunk_sha: string } | undefined;
          if (row && row.chunk_sha === sha(slice)) pointerOk++;
        }
      }
    }

    outcomes.push({
      id: q.id, group: q.group, query: q.query, rank, sectionHit: sHit, versionHit: vHit,
      top1Score: page.results[0]?.score ?? null, ms,
      top: page.results.slice(0, 5).map((r) => keyOf.get(r.id) ?? `#${r.id}`),
      ...(unresolved.length ? { unresolved } : {}),
    });
  }

  let sc005: RunResult["sc005"] = null;
  if (a.label !== "baseline" && a.sotRepo && after) {
    const cards = db.prepare("SELECT body FROM contents WHERE source_key LIKE 'sot:%'").all() as { body: string }[];
    const texts: string[] = [];
    const paths: string[] = [];
    for (const c of cards) {
      const commit = cardCommit(c.body);
      const path = /^- path: `([^`]+)`/m.exec(c.body)?.[1];
      if (commit && path) { texts.push(git(a.sotRepo, ["show", `${commit}:${path}`])); paths.push(path); }
    }
    const m = scanDb(db, sotWindows(texts, paths));
    sc005 = { matches: m.length, samples: m.slice(0, 20) };
  }

  const groups = aggregate(outcomes, GROUPS);
  const ms = outcomes.map((o) => o.ms);
  let sotCommit: string | null = null;
  try { sotCommit = golden.header?.sot_ref ? String(golden.header.sot_ref) : null; } catch { /* none */ }
  let kbCommit = "unknown";
  try { kbCommit = git(resolve(a.kbSrc), ["rev-parse", "HEAD"]).trim(); } catch { kbCommit = a.label === "baseline" ? "14ce2fc (git archive)" : "unknown"; }
  db.close();
  const importJson = a.importJson && existsSync(a.importJson) ? (JSON.parse(readFileSync(a.importJson, "utf8")) as { elapsed_ms?: number; import_ms?: number }) : null;

  const result: RunResult = {
    label: a.label, kb_src: resolve(a.kbSrc), kb_commit: kbCommit, sot_commit: sotCommit,
    golden_sha256: golden.freeze.sha256, frozen_at: golden.freeze.frozen_at,
    db: a.db, db_bytes: statSync(a.db).size, import_ms: importJson?.elapsed_ms ?? importJson?.import_ms ?? null,
    groups, no_answer_ratio: noAnswerRatio(outcomes),
    pointer: a.sotRepo && chunkSha ? { checked: pointerChecked, ok: pointerOk } : null,
    query_ms: { p50: percentile(ms, 50), p95: percentile(ms, 95) },
    outcomes, sc005, real_db: { before, after: realDbStat() },
    missing_embeddings: { docs: missingDocs, sections: missingSections },
  };
  return { code: 0, result };
}

const pct = (x: number | null) => (x === null ? "N/A" : `${(x * 100).toFixed(1)}%`);
const num = (x: number | null, d = 3) => (x === null ? "N/A" : x === Number.POSITIVE_INFINITY ? "∞" : x.toFixed(d));

export type Verdict = { pass: boolean; lines: string[] };

export function verdict(r: RunResult, base: RunResult | null, extra: { freeze: Freeze; firstFeatureCommitAt: string | null; import1?: Record<string, unknown> | null; import2?: Record<string, unknown> | null }): Verdict {
  const lines: string[] = [];
  const check = (name: string, ok: boolean, detail: string) => { lines.push(`| ${name} | ${ok ? "PASS" : "FAIL"} | ${detail} |`); return ok; };
  let pass = true;
  const g = (name: string, rr: RunResult) => rr.groups.find((x) => x.group === name)!;
  pass = check("SC-001 jp2 hit@5 = 100%", g("jp2", r).hit5 === 1, pct(g("jp2", r).hit5)) && pass;
  if (base) {
    const worse = GROUPS.filter((name) => name !== "no-answer").filter((name) => (g(name, r).hit5 ?? 0) < (g(name, base).hit5 ?? 0) || (g(name, r).mrr ?? 0) < (g(name, base).mrr ?? 0) - 1e-12);
    const ratioOk = (r.no_answer_ratio ?? 0) >= (base.no_answer_ratio ?? 0);
    pass = check("SC-002 no group below baseline (hit@5, MRR); no-answer ratio >= baseline", worse.length === 0 && ratioOk,
      `${worse.length ? `worse: ${worse.join(", ")}` : "no group worse"}; ratio ${num(r.no_answer_ratio)} vs ${num(base.no_answer_ratio)}`) && pass;
  } else {
    pass = check("SC-002 vs baseline", false, "no baseline results given") && pass;
  }
  pass = check("SC-003 pointer-ok = 100%", !!r.pointer && r.pointer.checked > 0 && r.pointer.ok === r.pointer.checked, r.pointer ? `${r.pointer.ok}/${r.pointer.checked}` : "not measured") && pass;
  const frozenBefore = extra.firstFeatureCommitAt === null || new Date(extra.freeze.frozen_at) < new Date(extra.firstFeatureCommitAt);
  pass = check("SC-004 golden frozen before first feature commit, hash ok", frozenBefore, `frozen_at ${extra.freeze.frozen_at}; first feature commit ${extra.firstFeatureCommitAt ?? "none"}`) && pass;
  pass = check("SC-005 0 SOT strings in DB", !!r.sc005 && r.sc005.matches === 0, r.sc005 ? `${r.sc005.matches} match(es)` : "not measured") && pass;
  const i1 = extra.import1 as { docs?: { created: number }; cards?: { created: number }; missing_embeddings?: number; doc_count?: number; residue_count?: number; card_count?: number } | null | undefined;
  const i2 = extra.import2 as { writes?: number } | null | undefined;
  if (i1) {
    pass = check("SC-006 29 docs (23 + 6 fork-residue) in feec-phase1", i1.doc_count === 23 && i1.residue_count === 6, `docs ${i1.doc_count} + residues ${i1.residue_count}`) && pass;
    pass = check("SC-007 14 cards in feec-phase1-sot", i1.card_count === 14, `cards ${i1.card_count}`) && pass;
  } else {
    pass = check("SC-006/SC-007 import counts", false, "no import result given") && pass;
  }
  pass = check("SC-006/SC-007 second import writes = 0", !!i2 && i2.writes === 0, i2 ? `writes ${i2.writes}` : "no second import result") && pass;
  pass = check("SC-008 real DB mtime/size unchanged", r.real_db.before === r.real_db.after, `${r.real_db.before} -> ${r.real_db.after}`) && pass;
  return { pass, lines };
}

export function renderReport(r: RunResult, base: RunResult | null, v: Verdict | null): string {
  const b = (name: string) => base?.groups.find((x) => x.group === name);
  const rows = r.groups.map((x) => {
    const bb = b(x.group);
    return `| ${x.group} | ${x.n} | ${pct(x.hit1)} | ${pct(x.hit5)} | ${bb ? pct(bb.hit5) : "—"} | ${num(x.mrr)} | ${bb ? num(bb.mrr) : "—"} | ${pct(x.sectionHit)} | ${pct(x.versionHit)} |`;
  });
  const misses = r.outcomes.filter((o) => o.group !== "no-answer" && (o.rank === null || o.rank > 5));
  return [
    `# R-Q1 report — ${r.label}`,
    "",
    `- kb_commit: \`${r.kb_commit}\` (src ${r.kb_src})`,
    `- sot_commit: \`${r.sot_commit ?? "—"}\``,
    `- golden sha256: \`${r.golden_sha256}\` (frozen ${r.frozen_at})`,
    `- db: \`${r.db}\` — ${r.db_bytes} bytes; import ms: ${r.import_ms ?? "—"}`,
    `- query ms p50 / p95: ${num(r.query_ms.p50, 1)} / ${num(r.query_ms.p95, 1)}`,
    `- missing embeddings: docs ${r.missing_embeddings.docs}, sections ${r.missing_embeddings.sections}`,
    `- pointer-ok: ${r.pointer ? `${r.pointer.ok}/${r.pointer.checked}` : "N/A"}`,
    `- no-answer ratio (ASM-10): ${num(r.no_answer_ratio)}${base ? ` (baseline ${num(base.no_answer_ratio)})` : ""}`,
    `- SC-005 matches: ${r.sc005 ? r.sc005.matches : "N/A"}`,
    `- real DB stat: ${r.real_db.before} -> ${r.real_db.after}`,
    "",
    "| group | n | hit@1 | hit@5 | hit@5 base | MRR | MRR base | section-hit | version-hit |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    ...(v ? ["## Verdict", "", `**${v.pass ? "PASS" : "FAIL"}**`, "", "| check | result | detail |", "|---|---|---|", ...v.lines, ""] : []),
    "## Questions outside top 5",
    "",
    ...(misses.length ? misses.map((o) => `- ${o.id} (${o.group}) rank=${o.rank ?? ">10"} — \`${o.query}\` — top: ${o.top.join(", ")}${o.unresolved ? ` — UNRESOLVED ${o.unresolved.join(", ")}` : ""}`) : ["- none"]),
    "",
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = parse(process.argv.slice(2));
  const { code, result, message } = await runHarness(a);
  if (code !== 0 || !result) {
    process.stderr.write(`eval: ${message}\n`);
    process.exit(code);
  }
  const base = a.baseline ? (JSON.parse(readFileSync(a.baseline, "utf8")) as RunResult) : null;
  const readJson = (p?: string) => (p && existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>) : null);
  let firstFeatureCommitAt: string | null = null;
  try {
    const out = execFileSync("git", ["log", "--reverse", "--format=%cI", "14ce2fc..HEAD"], { encoding: "utf8" }).trim().split("\n")[0];
    firstFeatureCommitAt = out || null;
  } catch { /* not in the KB repo */ }
  const freeze = JSON.parse(readFileSync(a.freeze, "utf8")) as Freeze;
  const v = a.label === "baseline" ? null : verdict(result, base, { freeze, firstFeatureCommitAt, import1: readJson(a.importJson), import2: readJson(a.import2Json) });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(a.out, `${stamp}-${a.label}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "results.json"), JSON.stringify(result, null, 2));
  writeFileSync(join(dir, "report.md"), renderReport(result, base, v));
  process.stdout.write(JSON.stringify({ out: dir, verdict: v ? (v.pass ? "PASS" : "FAIL") : "n/a", groups: result.groups.map((g) => [g.group, g.hit5, g.mrr]) }) + "\n");
}
