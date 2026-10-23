import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, existsSync, chmodSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

const testDir = join(tmpdir(), `kb-logger-test-${process.pid}`);
process.env.KB_LOG_DIR = testDir;

const { logInfo, logWarn, logError } = await import("../../src/log/logger.js");

function readLog(): string {
  const today = new Date().toISOString().slice(0, 10);
  const p = join(testDir, `${today}.log`);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

function logLines(): string[] {
  return readLog().split("\n").filter(Boolean);
}

describe("logger", () => {
  beforeEach(() => {
    try { rmSync(testDir, { recursive: true }); } catch { /* ok */ }
    mkdirSync(testDir, { recursive: true });
    // Reset module state by wiping the log file
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true }); } catch { /* ok */ }
  });

  it("logInfo writes a correctly formatted INFO line", () => {
    logInfo("test_tool", { event: "start", workspace: "kb" });
    const lines = logLines();
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const last = lines[lines.length - 1];
    expect(last).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] INFO  test_tool event=start workspace=kb$/);
  });

  it("logWarn writes a WARN line", () => {
    logWarn("sync.join", { event: "diagnostic", msg: "DHT timeout" });
    const last = logLines().at(-1)!;
    expect(last).toContain("] WARN  sync.join");
    expect(last).toContain("event=diagnostic");
  });

  it("logError with Error object writes ERROR line with error= and indented stack", () => {
    logError("create_content", new Error("oops"));
    const content = readLog();
    expect(content).toContain("] ERROR create_content");
    expect(content).toContain("error=oops");
    // stack trace indented on following lines
    expect(content).toContain("    at ");
  });

  it("logError with plain string writes ERROR line", () => {
    logError("tool", "something went wrong");
    const last = logLines().at(-1)!;
    expect(last).toContain("] ERROR tool");
    expect(last).toContain("error=something went wrong");
  });

  it("after 3 logInfo calls, file contains 3 lines", () => {
    logInfo("t", { event: "a" });
    logInfo("t", { event: "b" });
    logInfo("t", { event: "c" });
    expect(logLines().length).toBe(3);
  });

  it("redacts body field automatically", () => {
    logInfo("create_content", { event: "db_insert", body: "some long content here" });
    const last = logLines().at(-1)!;
    expect(last).not.toContain("some long content here");
    expect(last).toContain("[body redacted,");
  });

  it("does not throw when log directory is not writable", () => {
    // Make dir read-only
    try {
      chmodSync(testDir, 0o444);
      expect(() => logInfo("t", { event: "x" })).not.toThrow();
    } finally {
      try { chmodSync(testDir, 0o755); } catch { /* ok */ }
    }
  });
});
