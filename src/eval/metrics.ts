// Pure scoring for the R-Q1 harness.
import type { Group } from "./golden.js";

export type LineRange = { start_line: number; end_line: number };

export type QuestionOutcome = {
  id: string;
  group: Group;
  rank: number | null; // 1-based rank of the first relevant result within the top 10, null if absent
  sectionHit: boolean | null; // null = not applicable
  versionHit: boolean | null;
  top1Score: number | null;
  ms: number;
};

export type GroupMetrics = {
  group: Group;
  n: number;
  hit1: number | null;
  hit5: number | null;
  mrr: number | null;
  sectionHit: number | null;
  versionHit: number | null;
  sectionN: number;
  versionN: number;
};

export function rankOf(resultIds: number[], relevant: Set<number>, cutoff = 10): number | null {
  const i = resultIds.slice(0, cutoff).findIndex((id) => relevant.has(id));
  return i < 0 ? null : i + 1;
}

export function overlaps(a: LineRange, b: LineRange): boolean {
  return a.start_line <= b.end_line && b.start_line <= a.end_line;
}

export function sectionHit(matched: LineRange[], expected: LineRange[]): boolean {
  return matched.some((m) => expected.some((e) => overlaps(m, e)));
}

export function versionHit(relation: "current" | "history", expectCommit: string, cardCommit: string | null, cardHistory: string[]): boolean {
  if (relation === "current") return cardCommit === expectCommit;
  return cardHistory.includes(expectCommit);
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

/** ASM-10: median top-1 score of answerable questions ÷ median top-1 score of no-answer questions. */
export function noAnswerRatio(outcomes: QuestionOutcome[]): number | null {
  const answered = median(outcomes.filter((o) => o.group !== "no-answer" && o.top1Score !== null).map((o) => o.top1Score!));
  const none = median(outcomes.filter((o) => o.group === "no-answer" && o.top1Score !== null).map((o) => o.top1Score!));
  if (answered === null) return null;
  if (none === null || none === 0) return Number.POSITIVE_INFINITY;
  return answered / none;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function aggregate(outcomes: QuestionOutcome[], groups: readonly Group[]): GroupMetrics[] {
  return groups.map((group) => {
    const qs = outcomes.filter((o) => o.group === group);
    const scored = group === "no-answer" ? [] : qs;
    const sec = qs.filter((o) => o.sectionHit !== null);
    const ver = qs.filter((o) => o.versionHit !== null);
    return {
      group,
      n: qs.length,
      hit1: mean(scored.map((o) => (o.rank === 1 ? 1 : 0))),
      hit5: mean(scored.map((o) => (o.rank !== null && o.rank <= 5 ? 1 : 0))),
      mrr: mean(scored.map((o) => (o.rank ? 1 / o.rank : 0))),
      sectionHit: mean(sec.map((o) => (o.sectionHit ? 1 : 0))),
      versionHit: mean(ver.map((o) => (o.versionHit ? 1 : 0))),
      sectionN: sec.length,
      versionN: ver.length,
    };
  });
}

/** Resolve a golden key: exact match, else a unique '/'-boundary path suffix in the same `kind:workspace:` space. */
export function resolveKey(goldenKey: string, keys: Iterable<string>): string | null {
  const all = [...keys];
  if (all.includes(goldenKey)) return goldenKey;
  const m = /^([^:]+:[^:]+:)(.*)$/.exec(goldenKey);
  if (!m) return null;
  const [, prefix, rest] = m;
  const hits = all.filter((k) => k.startsWith(prefix) && k.endsWith(`/${rest}`));
  return hits.length === 1 ? hits[0] : null;
}
