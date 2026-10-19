import { describe, it, expect } from "vitest";
import { relPathFor, cloneOf, isImportableDoc, classifyDoc, classifyCard, docSourceKey, residueSourceKey, cardSourceKey } from "../../src/import/classify.js";

describe("classify", () => {
  it("drops the clone name: identity path is the part under .claude/claude/", () => {
    expect(relPathFor("/w/clone-2/.claude/claude/docs/project-docs/a.md", "/w/clone-2/.claude/claude/docs/project-docs"))
      .toBe("docs/project-docs/a.md");
    expect(cloneOf("/w/clone-2/.claude/claude/docs/project-docs/a.md", "/x")).toBe("clone-2");
    expect(relPathFor("/src/notes/a.md", "/src")).toBe("notes/a.md");
  });

  it("docs/ ⇒ type doc, feature _project-docs; title = first H1 else file name", () => {
    expect(classifyDoc("docs/project-docs/a.md", "intro\n# Hello\n## x")).toMatchObject({ type: "doc", features: ["_project-docs"], title: "Hello" });
    expect(classifyDoc("docs/project-docs/b-note.md", "no heading")).toMatchObject({ title: "b-note" });
    expect(classifyDoc("docs/reports/july.report.md", "x")).toMatchObject({ type: "report", features: ["_reports"] });
  });

  it("derives epic + issue features and type from other stage folders", () => {
    expect(classifyDoc("specs/2198-ES/2196-list/2196-refactor.spec.md", "x")).toMatchObject({ type: "spec", features: ["2198-ES", "2196-list"] });
    expect(classifyDoc("analyze/multi-region.analyze.md", "x")).toMatchObject({ type: "analyze", features: ["multi-region"] });
    expect(classifyDoc("specs/e/i/x.fe.spec.md", "x").features).toContain("lane:fe");
  });

  it("wraps .mmd in a mermaid fence", () => {
    expect(classifyDoc("docs/d/flow.mmd", "graph TD\nA-->B\n").body).toBe("```mermaid\ngraph TD\nA-->B\n```\n");
  });

  it("excludes compacts, scratch, chain steps, jsonl and non-markdown", () => {
    for (const p of ["compacts/a.md", "docs/scratch/a.md", "chain/x/y/steps/01.md", "chain/x/payload-1.md", "a.jsonl", "x/contract.json", "img.png", "a.py"]) {
      expect(isImportableDoc(p), p).toBe(false);
    }
    expect(isImportableDoc("docs/a.md")).toBe(true);
    expect(isImportableDoc("chain/x/resolved.md")).toBe(true);
  });

  it("builds source keys", () => {
    expect(docSourceKey("ws", "docs/a.md")).toBe("doc:ws:docs/a.md");
    expect(residueSourceKey("ws", "docs/a.md")).toBe("doc:ws:docs/a.md#fork-residue");
    expect(cardSourceKey("ws-sot", "0123456789ab", "docs/design/F-001-x.md")).toBe("sot:ws-sot:0123456789ab/docs/design/F-001-x.md");
  });

  it("classifies SOT cards: sot-spec / sot-status / sot-file with flow + parent-folder features", () => {
    expect(classifyCard("docs/design/business-design/F-002-genka.md", "# F-002 原価\nbody")).toEqual({
      type: "sot-spec", features: ["F-002", "business-design"], title: "F-002-genka.md · F-002 原価",
    });
    expect(classifyCard("docs/design/business-design/F-002-status.md", "x").type).toBe("sot-status");
    expect(classifyCard("docs/design/business-design/README.md", "# R").type).toBe("sot-file");
    expect(classifyCard("docs/design/business-design/flow-registry.conf", "# comment")).toEqual({
      type: "sot-file", features: ["business-design"], title: "flow-registry.conf",
    });
  });
});
