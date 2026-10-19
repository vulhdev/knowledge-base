import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyFreeze, parseGolden, validateGolden, sha256File, GoldenHashMismatch, GROUPS, type GoldenQuestion } from "../../src/eval/golden.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function questions(perGroup = 8): GoldenQuestion[] {
  return GROUPS.flatMap((g) => Array.from({ length: perGroup }, (_, i) => ({
    id: `${g}-${i}`, group: g, query: `q ${i}`, workspace: "ws",
    expect: g === "no-answer" ? null : { source_key: `doc:ws:a${i}.md` },
  })));
}

describe("golden", () => {
  it("refuses to run when the hash differs from the freeze record", () => {
    const d = mkdtempSync(join(tmpdir(), "kb-golden-")); dirs.push(d);
    const g = join(d, "g.jsonl"); const f = join(d, "f.json");
    writeFileSync(g, "{}\n");
    writeFileSync(f, JSON.stringify({ sha256: sha256File(g), frozen_at: "x", kb_head: "x", sot_commit: "x", approved_by: "x" }));
    expect(verifyFreeze(g, f).sha256).toBe(sha256File(g));
    writeFileSync(g, "{\"changed\":1}\n");
    expect(() => verifyFreeze(g, f)).toThrow(GoldenHashMismatch);
  });

  it("separates the header line from questions", () => {
    const text = [JSON.stringify({ _header: true, sot_ref: "abc" }), JSON.stringify(questions(1)[0])].join("\n");
    const r = parseGolden(text);
    expect(r.header?.sot_ref).toBe("abc");
    expect(r.questions).toHaveLength(1);
  });

  it("enforces SC-004: >= 50 questions and >= 5 per group", () => {
    expect(validateGolden(questions(8))).toEqual([]);
    const p = validateGolden(questions(4));
    expect(p.some((x) => x.includes("need >= 50"))).toBe(true);
    expect(p.some((x) => x.includes("need >= 5"))).toBe(true);
  });

  it("checks answer shape", () => {
    const qs = questions(8);
    qs[0] = { ...qs[0], expect: {} };
    qs[1] = { ...qs[1], expect: { source_key: "x", commit: "short", commit_relation: "current" } };
    const na = qs.findIndex((q) => q.group === "no-answer");
    qs[na] = { ...qs[na], expect: { source_key: "x" } };
    const p = validateGolden(qs);
    expect(p).toHaveLength(3);
  });

  it("accepts any_of answers", () => {
    const qs = questions(8);
    qs[0] = { ...qs[0], expect: { any_of: ["sot:ws:a", "sot:ws:b"] } };
    expect(validateGolden(qs)).toEqual([]);
  });
});
