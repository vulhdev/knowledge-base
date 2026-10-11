import { describe, it, expect } from "vitest";
import { rankOf, sectionHit, versionHit, noAnswerRatio, aggregate, resolveKey, median, percentile, type QuestionOutcome } from "../../src/eval/metrics.js";

const o = (p: Partial<QuestionOutcome>): QuestionOutcome => ({ id: "x", group: "jp2", rank: null, sectionHit: null, versionHit: null, top1Score: null, ms: 1, ...p });

describe("metrics", () => {
  it("ranks the first relevant result within the top 10 (any-of)", () => {
    expect(rankOf([5, 6, 7], new Set([7]))).toBe(3);
    expect(rankOf([5, 6, 7], new Set([6, 7]))).toBe(2);
    expect(rankOf(Array.from({ length: 12 }, (_, i) => i), new Set([11]))).toBeNull();
  });

  it("section-hit is line-range intersection", () => {
    expect(sectionHit([{ start_line: 10, end_line: 20 }], [{ start_line: 20, end_line: 30 }])).toBe(true);
    expect(sectionHit([{ start_line: 10, end_line: 19 }], [{ start_line: 20, end_line: 30 }])).toBe(false);
    expect(sectionHit([], [{ start_line: 1, end_line: 2 }])).toBe(false);
  });

  it("version-hit: current = card commit, history = commit listed in the card history", () => {
    expect(versionHit("current", "a", "a", [])).toBe(true);
    expect(versionHit("current", "a", "b", ["a"])).toBe(false);
    expect(versionHit("history", "a", "b", ["b", "a"])).toBe(true);
  });

  it("aggregates hit@1, hit@5, MRR (0 outside top 10) per group", () => {
    const m = aggregate([o({ rank: 1 }), o({ rank: 4 }), o({ rank: null }), o({ group: "no-answer", top1Score: 0.01 })], ["jp2", "no-answer"]);
    expect(m[0]).toMatchObject({ n: 3, hit1: 1 / 3, hit5: 2 / 3 });
    expect(m[0].mrr).toBeCloseTo((1 + 0.25 + 0) / 3);
    expect(m[1]).toMatchObject({ n: 1, hit1: null, hit5: null, mrr: null });
  });

  it("ASM-10 ratio = median answered top-1 ÷ median no-answer top-1", () => {
    const r = noAnswerRatio([o({ top1Score: 0.04 }), o({ top1Score: 0.02 }), o({ group: "no-answer", top1Score: 0.01 })]);
    expect(r).toBeCloseTo(3);
  });

  it("resolves golden keys exactly, else by unique path suffix", () => {
    const keys = ["doc:ws:docs/p/a.md", "doc:ws:docs/p/b.md", "doc:ws:x/b.md", "sot:s:docs/F.md"];
    expect(resolveKey("sot:s:docs/F.md", keys)).toBe("sot:s:docs/F.md");
    expect(resolveKey("doc:ws:a.md", keys)).toBe("doc:ws:docs/p/a.md");
    expect(resolveKey("doc:ws:b.md", keys)).toBeNull();
    expect(resolveKey("doc:other:a.md", keys)).toBeNull();
  });

  it("median and percentile", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
  });
});
