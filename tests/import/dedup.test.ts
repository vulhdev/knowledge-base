import { describe, it, expect } from "vitest";
import { dedupFiles, seriesStem, type SourceFile } from "../../src/import/dedup.js";

let t = 1_000;
function f(clone: string, relPath: string, text: string, mtimeMs = t++): SourceFile {
  return { clone, relPath, absPath: `/${clone}/${relPath}`, text, mtimeMs };
}

describe("dedupFiles — same path", () => {
  it("keeps a single copy", () => {
    const r = dedupFiles([f("c1", "docs/a.md", "a")]);
    expect(r.docs).toHaveLength(1);
    expect(r.docs[0].decision).toBe("single");
  });

  it("collapses identical copies to one", () => {
    const r = dedupFiles([f("c1", "docs/a.md", "x\ny"), f("c2", "docs/a.md", "x\ny")]);
    expect(r.docs).toHaveLength(1);
    expect(r.docs[0].decision).toBe("identical");
  });

  it("takes the superset when the other copy has no line of its own", () => {
    const r = dedupFiles([f("c1", "docs/a.md", "x\ny\nz", 1), f("c2", "docs/a.md", "x\nz", 9)]);
    expect(r.docs[0].decision).toBe("superset");
    expect(r.docs[0].canonical.clone).toBe("c1");
    expect(r.docs[0].residue).toBeUndefined();
  });

  it("FORK: canonical is the latest mtime, residue holds the other side's own lines, reason logged", () => {
    const r = dedupFiles([f("c1", "docs/a.md", "h\nonly-1\nt", 5), f("c2", "docs/a.md", "h\nonly-2a\nt\nonly-2b", 2)]);
    const d = r.docs[0];
    expect(d.decision).toBe("fork");
    expect(d.canonical.clone).toBe("c1");
    expect(d.residue).toEqual({ fromClone: "c2", fromAbsPath: "/c2/docs/a.md", lines: ["only-2a", "only-2b"] });
    expect(r.log.some((l) => l.startsWith("fork") && l.includes("docs/a.md"))).toBe(true);
  });
});

describe("dedupFiles — across paths", () => {
  it("collapses identical content under two paths into one doc with an alias", () => {
    const r = dedupFiles([f("c1", "docs/x_technical_document.md", "same", 1), f("c2", "docs/x_20260629.md", "same", 2)]);
    expect(r.docs).toHaveLength(1);
    expect(r.docs[0].relPath).toBe("docs/x_20260629.md");
    expect(r.docs[0].aliases.map((a) => a.relPath)).toEqual(["docs/x_technical_document.md"]);
    expect(r.log.some((l) => l.startsWith("alias"))).toBe(true);
  });

  it("links a date-suffixed series parent (undated / shortest name) → children (dated)", () => {
    const r = dedupFiles([
      f("c1", "docs/x-20260828.md", "v1"),
      f("c2", "docs/x.md", "v0"),
      f("c1", "docs/y.prompt.md", "p"),
      f("c1", "docs/y-20260829.md", "q"),
      f("c1", "docs/z_20260629.md", "r"),
      f("c2", "docs/z_20260730.md", "s"),
      f("c2", "docs/other.md", "o"),
    ]);
    expect(r.docs).toHaveLength(7);
    expect(r.series).toEqual(expect.arrayContaining([
      { parentRelPath: "docs/x.md", childRelPath: "docs/x-20260828.md" },
      { parentRelPath: "docs/y.prompt.md", childRelPath: "docs/y-20260829.md" },
      { parentRelPath: "docs/z_20260629.md", childRelPath: "docs/z_20260730.md" },
    ]));
    expect(r.series).toHaveLength(3);
  });

  it("treats x_technical_document and x_20260730 as one series", () => {
    const r = dedupFiles([f("c1", "docs/x_technical_document.md", "a"), f("c2", "docs/x_20260730.md", "b")]);
    expect(r.series).toEqual([{ parentRelPath: "docs/x_technical_document.md", childRelPath: "docs/x_20260730.md" }]);
  });

  it("does not link different stems or different folders", () => {
    const r = dedupFiles([f("c1", "docs/x.md", "a"), f("c1", "docs/xy.md", "b"), f("c1", "other/x-20260101.md", "c")]);
    expect(r.series).toEqual([]);
  });
});

describe("seriesStem", () => {
  it("drops date tokens and .prompt", () => {
    expect(seriesStem("docs/docs.3_ai-workflows-20260828.md")).toBe("docs.3_ai-workflows");
    expect(seriesStem("docs/docs.5_project-rules.prompt.md")).toBe("docs.5_project-rules");
    expect(seriesStem("docs/docs.be.20260620.md")).toBe("docs.be.20260620");
  });
});
