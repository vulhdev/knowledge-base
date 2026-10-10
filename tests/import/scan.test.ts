import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSources } from "../../src/import/scan.js";
import { makeRepo, type Repo } from "./git-fixture.js";

let repo: Repo | null = null;
const extra: string[] = [];
afterEach(() => { repo?.cleanup(); repo = null; for (const d of extra.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("scanSources", () => {
  it("puts tracked files in branch B and ignored/untracked files in branch A — no folder list", () => {
    repo = makeRepo();
    repo.write(".gitignore", ".claude/claude\n");
    repo.write("docs/design/F-001-x.md", "# F-001\n");
    repo.write("docs/design/conf.conf", "a=b\n");
    const c = repo.commit("init");
    repo.write("docs/design/draft.md", "# untracked draft\n");
    repo.write(".claude/claude/docs/project-docs/a.md", "# A\n");

    const sot = scanSources([join(repo.dir, "docs/design")]);
    expect(sot.bFiles.map((b) => b.repoPath)).toEqual(["docs/design/F-001-x.md", "docs/design/conf.conf"]);
    expect(sot.bFiles[0]).toMatchObject({ ref: "HEAD", commit: c });
    expect(sot.aFiles.map((a) => a.relPath)).toEqual(["draft.md"]);

    const personal = scanSources([join(repo.dir, ".claude/claude/docs/project-docs")]);
    expect(personal.bFiles).toEqual([]);
    expect(personal.aFiles.map((a) => a.relPath)).toEqual(["docs/project-docs/a.md"]);
    expect(personal.aFiles[0].clone).toBe(repo.dir.split("/").pop());
  });

  it("treats a folder outside git as branch A and honours exclusions", () => {
    const d = mkdtempSync(join(tmpdir(), "kb-scan-"));
    extra.push(d);
    mkdirSync(join(d, "scratch"));
    writeFileSync(join(d, "a.md"), "# a");
    writeFileSync(join(d, "scratch", "b.md"), "# b");
    writeFileSync(join(d, "c.png"), "x");
    const r = scanSources([d]);
    expect(r.bFiles).toEqual([]);
    expect(r.aFiles.map((a) => a.relPath)).toEqual(["a.md"]);
  });

  it("reads branch B from a ref override", () => {
    repo = makeRepo();
    repo.write("s/a.md", "1");
    const c1 = repo.commit("one");
    repo.write("s/b.md", "2");
    repo.commit("two");
    const r = scanSources([join(repo.dir, "s")], { ref: c1 });
    expect(r.bFiles.map((b) => b.repoPath)).toEqual(["s/a.md"]);
    expect(r.warnings.some((w) => w.includes("s/b.md"))).toBe(true);
  });
});
