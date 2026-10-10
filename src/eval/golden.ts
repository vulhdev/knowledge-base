// Golden set loading for the R-Q1 harness: hash check against the freeze record, schema check.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const GROUPS = ["jp2", "jp-long", "cross-lingual", "deep-detail", "sot-version", "fork", "no-answer"] as const;
export type Group = (typeof GROUPS)[number];

export type ExpectedSection = { heading_path: string; start_line: number; end_line: number };

export type Expect = {
  source_key?: string;
  any_of?: string[];
  sections?: ExpectedSection[];
  commit?: string;
  commit_relation?: "current" | "history";
  anchor?: string;
};

export type GoldenQuestion = { id: string; group: Group; query: string; workspace: string | null; expect: Expect | null; note?: string };

export type GoldenHeader = { _header: true; sot_ref?: string; sot_repo?: string; [k: string]: unknown };

export type Freeze = { sha256: string; frozen_at: string; kb_head: string; sot_commit: string; approved_by: string };

export class GoldenHashMismatch extends Error {
  constructor(actual: string, expected: string) {
    super(`golden set sha256 ${actual} does not match the freeze record ${expected} — refusing to run`);
  }
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function verifyFreeze(goldenPath: string, freezePath: string): Freeze {
  const freeze = JSON.parse(readFileSync(freezePath, "utf8")) as Freeze;
  const actual = sha256File(goldenPath);
  if (actual !== freeze.sha256) throw new GoldenHashMismatch(actual, freeze.sha256);
  return freeze;
}

export function parseGolden(text: string): { header: GoldenHeader | null; questions: GoldenQuestion[] } {
  let header: GoldenHeader | null = null;
  const questions: GoldenQuestion[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as Record<string, unknown>;
    if (row._header === true) header = row as GoldenHeader;
    else questions.push(row as unknown as GoldenQuestion);
  }
  return { header, questions };
}

/** Schema + SC-004 shape: >= 50 questions, every group >= 5, every answer well-formed. Returns problems. */
export function validateGolden(questions: GoldenQuestion[]): string[] {
  const problems: string[] = [];
  if (questions.length < 50) problems.push(`only ${questions.length} questions (need >= 50)`);
  for (const g of GROUPS) {
    const n = questions.filter((q) => q.group === g).length;
    if (n < 5) problems.push(`group ${g} has ${n} questions (need >= 5)`);
  }
  const ids = new Set<string>();
  for (const q of questions) {
    if (ids.has(q.id)) problems.push(`duplicate id ${q.id}`);
    ids.add(q.id);
    if (!GROUPS.includes(q.group)) problems.push(`${q.id}: unknown group ${q.group}`);
    if (!q.query?.trim()) problems.push(`${q.id}: empty query`);
    if (q.group === "no-answer") {
      if (q.expect !== null) problems.push(`${q.id}: no-answer must have expect = null`);
      continue;
    }
    if (!q.expect) { problems.push(`${q.id}: missing expect`); continue; }
    if (!q.expect.source_key && !q.expect.any_of?.length) problems.push(`${q.id}: expect needs source_key or any_of`);
    if (q.expect.commit_relation && !/^[0-9a-f]{40}$/.test(q.expect.commit ?? "")) problems.push(`${q.id}: commit must be 40 hex`);
  }
  return problems;
}

export function loadGolden(goldenPath: string, freezePath: string) {
  const freeze = verifyFreeze(goldenPath, freezePath);
  const parsed = parseGolden(readFileSync(goldenPath, "utf8"));
  return { freeze, ...parsed, problems: validateGolden(parsed.questions) };
}
