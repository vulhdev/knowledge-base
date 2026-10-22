import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const DEFAULT_LOCK_DIR = join(homedir(), ".claude", "knowledge-base");

export function lockPath(workspaceName: string, dir?: string): string {
  return join(dir ?? DEFAULT_LOCK_DIR, `${workspaceName}.sync.lock`);
}

export function acquireSyncLock(workspaceName: string, dir?: string): (() => void) | null {
  const path = lockPath(workspaceName, dir);

  if (existsSync(path)) {
    const content = readFileSync(path, "utf8").trim();
    const pid = Number(content);
    if (!isNaN(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        // Process is alive — lock is held
        return null;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ESRCH") {
          // EPERM: process alive but unpermissioned — treat as held
          return null;
        }
        // ESRCH: process is dead — stale lock, overwrite
      }
    }
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${process.pid}\n`, "utf8");

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    try { unlinkSync(path); } catch { /* already gone */ }
    process.removeListener("exit", release);
  };

  process.on("exit", release);
  return release;
}
