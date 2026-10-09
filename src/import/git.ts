// Thin git wrappers for the importer. Every call is `git -C <dir> …` via execFileSync — no shell.
import { execFileSync } from "node:child_process";

function git(dir: string, args: string[], opts: { allowFail?: boolean } = {}): string | null {
  try {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    if (opts.allowFail) return null;
    const e = err as { stderr?: string; message: string };
    throw new Error(`git ${args.join(" ")} failed in ${dir}: ${(e.stderr ?? e.message).toString().trim()}`);
  }
}

/** Repository root containing `dir`, or null when `dir` is not inside a git work tree. */
export function gitRoot(dir: string): string | null {
  const out = git(dir, ["rev-parse", "--show-toplevel"], { allowFail: true });
  return out ? out.trim() : null;
}

/** Ref to read from: the override, else the branch upstream, else HEAD. Returns the ref and its commit. */
export function resolveRef(root: string, override?: string): { ref: string; commit: string } {
  let ref = override;
  if (!ref) {
    const up = git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { allowFail: true });
    ref = up && up.trim() ? up.trim() : "HEAD";
  }
  const commit = git(root, ["rev-parse", "--verify", `${ref}^{commit}`])!.trim();
  return { ref, commit };
}

/** Files tracked at `commit` under `relDir` (repo-relative paths). */
export function listTrackedAtRef(root: string, commit: string, relDir: string): string[] {
  const args = ["ls-tree", "-r", "--name-only", commit];
  if (relDir && relDir !== ".") args.push("--", relDir);
  return git(root, args)!.split("\n").filter((l) => l !== "");
}

export function isIgnored(root: string, relPath: string): boolean {
  return git(root, ["check-ignore", "-q", "--", relPath], { allowFail: true }) !== null;
}

export function isTracked(root: string, relPath: string): boolean {
  return git(root, ["ls-files", "--error-unmatch", "--", relPath], { allowFail: true }) !== null;
}

/** File content at a commit — never the working tree. */
export function showAtCommit(root: string, commit: string, relPath: string): string {
  return git(root, ["show", `${commit}:${relPath}`])!;
}

/** Commits touching the file up to `commit`, newest first. */
export function fileHistory(root: string, commit: string, relPath: string): { hash: string; date: string }[] {
  return git(root, ["log", "--format=%H %cI", commit, "--", relPath])!
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => {
      const [hash, date] = l.split(" ");
      return { hash, date };
    });
}
