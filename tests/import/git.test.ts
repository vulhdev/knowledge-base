import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitRoot, resolveRef, listTrackedAtRef, isIgnored, isTracked, showAtCommit, fileHistory } from "../../src/import/git.js";
import { makeRepo, type Repo } from "./git-fixture.js";

let repo: Repo | null = null;
afterEach(() => { repo?.cleanup(); repo = null; });

describe("import/git", () => {
  it("finds the repo root, or null outside git", () => {
    repo = makeRepo();
    repo.write("docs/a.md", "a");
    repo.commit("init");
    expect(realpathSync(gitRoot(join(repo.dir, "docs"))!)).toBe(realpathSync(repo.dir));
    const outside = mkdtempSync(join(tmpdir(), "kb-nogit-"));
    expect(gitRoot(outside)).toBeNull();
    rmSync(outside, { recursive: true, force: true });
  });

  it("resolves HEAD when there is no upstream, an upstream when there is one, and an override", () => {
    repo = makeRepo();
    repo.write("a.md", "1");
    const c1 = repo.commit("one");
    expect(resolveRef(repo.dir)).toEqual({ ref: "HEAD", commit: c1 });
    repo.git("branch", "-q", "base");
    repo.write("a.md", "2");
    const c2 = repo.commit("two");
    repo.git("branch", "-q", "--set-upstream-to=base");
    expect(resolveRef(repo.dir)).toEqual({ ref: "base", commit: c1 });
    expect(resolveRef(repo.dir, "main").commit).toBe(c2);
  });

  it("throws a clear error for a ref that does not exist", () => {
    repo = makeRepo();
    repo.write("a.md", "1");
    repo.commit("one");
    expect(() => resolveRef(repo!.dir, "nope")).toThrow(/git rev-parse/);
  });

  it("lists tracked files at a ref, and tells ignored/untracked apart", () => {
    repo = makeRepo();
    repo.write(".gitignore", "secret/\n");
    repo.write("docs/a.md", "a");
    const c = repo.commit("init");
    repo.write("docs/untracked.md", "u");
    repo.write("secret/x.md", "x");
    expect(listTrackedAtRef(repo.dir, c, "docs")).toEqual(["docs/a.md"]);
    expect(isTracked(repo.dir, "docs/a.md")).toBe(true);
    expect(isTracked(repo.dir, "docs/untracked.md")).toBe(false);
    expect(isIgnored(repo.dir, "secret/x.md")).toBe(true);
    expect(isIgnored(repo.dir, "docs/a.md")).toBe(false);
  });

  it("reads content at a commit, not from the working tree, and lists history", () => {
    repo = makeRepo();
    repo.write("a.md", "v1");
    const c1 = repo.commit("one");
    repo.write("a.md", "v2");
    const c2 = repo.commit("two");
    repo.write("a.md", "local edit");
    expect(showAtCommit(repo.dir, c2, "a.md")).toBe("v2");
    expect(showAtCommit(repo.dir, c1, "a.md")).toBe("v1");
    const hist = fileHistory(repo.dir, c2, "a.md");
    expect(hist.map((h) => h.hash)).toEqual([c2, c1]);
    expect(hist[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("import/git — non-ASCII paths", () => {
  it("lists Japanese file names verbatim (no C-quoting)", () => {
    repo = makeRepo();
    repo.write("docs/原価検討書.md", "a");
    repo.write("docs/plain.md", "b");
    const c = repo.commit("init");
    expect(listTrackedAtRef(repo.dir, c, "docs").sort()).toEqual(["docs/plain.md", "docs/原価検討書.md"].sort());
    expect(showAtCommit(repo.dir, c, "docs/原価検討書.md")).toBe("a");
  });
});
