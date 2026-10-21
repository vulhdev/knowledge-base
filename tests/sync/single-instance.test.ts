import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireSyncLock, lockPath } from "../../src/sync/lock.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kb-lock-"));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("acquireSyncLock", () => {
  it("returns a release function when no lock exists", () => {
    const dir = tmp();
    const release = acquireSyncLock("my-ws", dir);
    expect(typeof release).toBe("function");
    release?.();
  });

  it("returns null when the same process already holds the lock", () => {
    const dir = tmp();
    const release = acquireSyncLock("my-ws", dir);
    expect(release).not.toBeNull();

    const release2 = acquireSyncLock("my-ws", dir);
    expect(release2).toBeNull();

    release?.();
  });

  it("overwrites a stale lock whose PID no longer exists", () => {
    const dir = tmp();
    const path = lockPath("my-ws", dir);
    writeFileSync(path, "999999999\n"); // dead PID

    const release = acquireSyncLock("my-ws", dir);
    expect(release).not.toBeNull();
    release?.();
  });

  it("release deletes the lock file", () => {
    const dir = tmp();
    const path = lockPath("my-ws", dir);

    const release = acquireSyncLock("my-ws", dir);
    expect(existsSync(path)).toBe(true);

    release?.();
    expect(existsSync(path)).toBe(false);
  });
});
