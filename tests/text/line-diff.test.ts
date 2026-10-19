import { describe, it, expect } from "vitest";
import { diffLines } from "../../src/text/line-diff.js";

describe("diffLines", () => {
  it("reports nothing for identical inputs", () => {
    const r = diffLines(["a", "b", "c"], ["a", "b", "c"]);
    expect(r.onlyA).toEqual([]);
    expect(r.onlyB).toEqual([]);
  });

  it("detects a superset: the longer side only adds lines", () => {
    const r = diffLines(["a", "c"], ["a", "b", "c", "d"]);
    expect(r.onlyA).toEqual([]);
    expect(r.onlyB).toEqual(["b", "d"]);
  });

  it("detects a FORK: both sides have lines of their own, in original order", () => {
    const r = diffLines(["h", "x1", "m", "x2", "t"], ["h", "y1", "m", "t", "y2"]);
    expect(r.onlyA).toEqual(["x1", "x2"]);
    expect(r.onlyB).toEqual(["y1", "y2"]);
  });

  it("handles empty sides", () => {
    expect(diffLines([], ["a"]).onlyB).toEqual(["a"]);
    expect(diffLines(["a"], []).onlyA).toEqual(["a"]);
    expect(diffLines([], [])).toEqual({ onlyA: [], onlyB: [] });
  });

  it("keeps duplicates that only one side has", () => {
    const r = diffLines(["a", "a", "b"], ["a", "b"]);
    expect(r.onlyA).toEqual(["a"]);
    expect(r.onlyB).toEqual([]);
  });

  it("scales to a thousand lines with a small edit distance", () => {
    const a = Array.from({ length: 1000 }, (_, i) => `line ${i}`);
    const b = [...a.slice(0, 500), "inserted", ...a.slice(501)];
    const r = diffLines(a, b);
    expect(r.onlyA).toEqual(["line 500"]);
    expect(r.onlyB).toEqual(["inserted"]);
  });
});

describe("diffLines property", () => {
  it("leaves the same common subsequence on both sides (random inputs)", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: Math.floor(rnd() * 12) }, () => "abcd"[Math.floor(rnd() * 4)]);
      const b = Array.from({ length: Math.floor(rnd() * 12) }, () => "abcd"[Math.floor(rnd() * 4)]);
      const r = diffLines(a, b);
      // brute-force LCS length
      const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
      for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
      expect(a.length - r.onlyA.length).toBe(dp[a.length][b.length]);
      expect(b.length - r.onlyB.length).toBe(dp[a.length][b.length]);
    }
  });
});
