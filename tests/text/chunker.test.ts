import { describe, it, expect } from "vitest";
import { chunkMarkdown, chunkLines, breadcrumb, sha256, sliceByLines } from "../../src/text/chunker.js";

const len = (s: string) => s.length; // fake token counter: 1 token per UTF-16 unit
const filler = (n: number) => "x".repeat(n);

function keys(body: string) {
  return chunkMarkdown(body, len).map((s) => s.chunk_key);
}

describe("chunkMarkdown — outline keys", () => {
  it("keys sections by tree position with a 0 preamble", () => {
    const body = [
      `intro ${filler(60)}`,
      `# A`, filler(60),
      `## A1`, filler(60),
      `### A1a`, filler(60),
      `#### A1a-i`, filler(60),
      `# B`, filler(60),
    ].join("\n");
    expect(keys(body)).toEqual(["0", "1", "1.1", "1.1.1", "1.1.1.1", "2"]);
  });

  it("keeps ##### and deeper inside the #### parent", () => {
    const body = [`# A`, filler(60), `#### D`, filler(60), `##### E`, filler(60), `###### F`, filler(60)].join("\n");
    const secs = chunkMarkdown(body, len);
    expect(secs.map((s) => s.chunk_key)).toEqual(["1", "1.1"]);
    expect(secs[1].end_line).toBe(8);
  });

  it("does not treat '#' inside a code fence as a heading", () => {
    const body = [`# A`, filler(60), "```bash", "# not a heading", "```", `# B`, filler(60)].join("\n");
    expect(keys(body)).toEqual(["1", "2"]);
  });

  it("does not collide on duplicate heading text", () => {
    const body = [`# A`, filler(60), `## Same`, filler(60), `## Same`, filler(60)].join("\n");
    expect(keys(body)).toEqual(["1", "1.1", "1.2"]);
  });

  it("inserting a section under another branch does not change this branch's keys", () => {
    const before = [`# A`, filler(60), `## A1`, filler(60), `# B`, filler(60), `## B1`, filler(60)].join("\n");
    const after = [`# A`, filler(60), `## A1`, filler(60), `## A2`, filler(60), `# B`, filler(60), `## B1`, filler(60)].join("\n");
    const b1 = (body: string) => chunkMarkdown(body, len).find((s) => s.heading_path === "B › B1")!.chunk_key;
    expect(b1(before)).toBe("2.1");
    expect(b1(after)).toBe("2.1");
  });

  it("builds heading_path from heading text", () => {
    const body = [`# Title`, filler(60), `## Sub`, filler(60)].join("\n");
    expect(chunkMarkdown(body, len).map((s) => s.heading_path)).toEqual(["Title", "Title › Sub"]);
  });
});

describe("chunkMarkdown — size rules", () => {
  it("merges a section under 40 tokens into the one that follows (receiver keeps its key)", () => {
    const body = [`# A`, filler(60), `## Small`, `tiny`, `## Next`, filler(60)].join("\n");
    const secs = chunkMarkdown(body, len);
    expect(secs.map((s) => s.chunk_key)).toEqual(["1", "1.2"]);
    expect(secs[1].start_line).toBe(3);
  });

  it("merges a trailing small section into the previous one", () => {
    const body = [`# A`, filler(60), `## Small`, `tiny`].join("\n");
    const secs = chunkMarkdown(body, len);
    expect(secs.map((s) => s.chunk_key)).toEqual(["1"]);
    expect(secs[0].end_line).toBe(4);
  });

  it("splits a section over 400 tokens at paragraph boundaries with ~n suffixes", () => {
    const body = [`# A`, filler(150), "", filler(150), "", filler(150), "", filler(150)].join("\n");
    const secs = chunkMarkdown(body, len);
    expect(secs.map((s) => s.chunk_key)).toEqual(["1", "1~2"]);
    for (const s of secs) expect(s.end_char - s.start_char).toBeLessThanOrEqual(420);
  });

  it("keeps a whole table and a whole fence in one part even when over 400 tokens", () => {
    const table = Array.from({ length: 30 }, () => `| ${filler(20)} | ${filler(20)} |`);
    const body = [`# A`, filler(50), "", ...table, "", "```", ...Array.from({ length: 10 }, () => filler(50)), "```"].join("\n");
    const secs = chunkMarkdown(body, len);
    const text = (s: { start_char: number; end_char: number }) => body.slice(s.start_char, s.end_char);
    const tablePart = secs.find((s) => text(s).includes("| x"))!;
    expect(text(tablePart).split("\n").filter((l) => l.startsWith("|")).length).toBe(30);
    const fencePart = secs.find((s) => text(s).includes("```"))!;
    expect(text(fencePart).split("```").length).toBe(3);
  });

  it("splits list items between items, never inside one", () => {
    const items = Array.from({ length: 12 }, (_, i) => `- item ${i} ${filler(60)}`);
    const body = [`# A`, ...items].join("\n");
    const secs = chunkMarkdown(body, len);
    expect(secs.length).toBeGreaterThan(1);
    for (const s of secs.slice(1)) expect(body.slice(s.start_char, s.end_char).startsWith("- item")).toBe(true);
  });

  it("gives a doc without headings a single 0 key (with parts when long)", () => {
    expect(keys(filler(100))).toEqual(["0"]);
    expect(keys([filler(300), "", filler(300)].join("\n"))).toEqual(["0", "0~2"]);
  });

  it("handles an empty body and a heading-only body without error", () => {
    expect(chunkMarkdown("", len).length).toBe(1);
    expect(chunkMarkdown("# Only", len).map((s) => s.chunk_key)).toEqual(["1"]);
  });
});

describe("chunkMarkdown — offsets and hashes", () => {
  it("start/end chars and lines agree with the body, and chunk_sha hashes the slice", () => {
    const body = ["前置き", `# 見出し`, `本文${filler(60)}`, `## 掛率`, `原価に掛率を乗じる。${filler(60)}`].join("\n");
    for (const s of chunkMarkdown(body, len)) {
      const slice = body.slice(s.start_char, s.end_char);
      expect(slice).toBe(sliceByLines(body, s.start_line, s.end_line));
      expect(s.chunk_sha).toBe(sha256(slice));
    }
  });

  it("assigns ord in document order", () => {
    const body = [`# A`, filler(60), `# B`, filler(60)].join("\n");
    expect(chunkMarkdown(body, len).map((s) => s.ord)).toEqual([0, 1]);
  });
});

describe("chunkLines", () => {
  it("cuts plain text at blank lines with keys 0, 0~2, …", () => {
    const text = [filler(200), filler(150), "", filler(200), "", filler(100)].join("\n");
    const secs = chunkLines(text, len);
    expect(secs[0].chunk_key).toBe("0");
    expect(secs.slice(1).map((s) => s.chunk_key)).toEqual(secs.slice(1).map((_, i) => `0~${i + 2}`));
    expect(secs[0].end_line).toBe(3);
    for (const s of secs) expect(s.chunk_sha).toBe(sha256(sliceByLines(text, s.start_line, s.end_line)));
  });

  it("returns one section for short text", () => {
    expect(chunkLines("a=b\nc=d", len).map((s) => s.chunk_key)).toEqual(["0"]);
  });
});

describe("breadcrumb", () => {
  it("joins title and heading path", () => {
    expect(breadcrumb("Doc", "A › B")).toBe("Doc › A › B");
    expect(breadcrumb(null, "A")).toBe("A");
    expect(breadcrumb("Doc", "")).toBe("Doc");
  });
});
