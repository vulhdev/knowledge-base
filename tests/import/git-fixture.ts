import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

export type Repo = { dir: string; write: (p: string, s: string) => void; commit: (msg: string) => string; git: (...a: string[]) => string; cleanup: () => void };

export function makeRepo(): Repo {
  const dir = mkdtempSync(join(tmpdir(), "kb-git-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  return {
    dir,
    git,
    write: (p, s) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); },
    commit: (msg) => { git("add", "-A"); git("commit", "-q", "-m", msg); return git("rev-parse", "HEAD").trim(); },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
