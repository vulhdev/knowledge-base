import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { filterLines, levelAtLeast, afterSince, readLogLines, parseSince } from "../../src/bin/log.js";

const SAMPLE_LINES = [
  "[2026-10-22 10:00:00] INFO  create_content event=start id=abc",
  "[2026-10-22 10:00:01] INFO  create_content event=done ms=50 id=abc",
  "[2026-10-22 10:00:02] WARN  sync event=join_result accepted=false",
  "[2026-10-22 10:00:03] ERROR team_join event=connect_timeout",
  "[2026-10-23 09:00:00] INFO  init event=start",
  "[2026-10-23 09:00:01] INFO  init event=model_check ready=false",
  "[2026-10-23 09:00:02] WARN  init event=model_download_failed",
];

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `kb-log-cli-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  writeFileSync(join(testDir, "2026-10-22.log"), SAMPLE_LINES.slice(0, 4).join("\n") + "\n");
  writeFileSync(join(testDir, "2026-10-23.log"), SAMPLE_LINES.slice(4).join("\n") + "\n");
  process.env.KB_LOG_DIR = testDir;
});

afterEach(() => {
  delete process.env.KB_LOG_DIR;
  rmSync(testDir, { recursive: true, force: true });
});

describe("readLogLines", () => {
  it("reads all lines from all log files sorted by date", () => {
    const lines = readLogLines(testDir);
    expect(lines).toHaveLength(7);
    expect(lines[0]).toContain("create_content event=start");
    expect(lines[6]).toContain("model_download_failed");
  });

  it("returns empty array when dir does not exist", () => {
    expect(readLogLines("/nonexistent/path")).toEqual([]);
  });
});

describe("levelAtLeast", () => {
  it("INFO >= INFO", () => expect(levelAtLeast("[...] INFO  src event=x", "INFO")).toBe(true));
  it("WARN >= INFO", () => expect(levelAtLeast("[...] WARN  src event=x", "INFO")).toBe(true));
  it("ERROR >= WARN", () => expect(levelAtLeast("[...] ERROR src event=x", "WARN")).toBe(true));
  it("INFO < WARN", () => expect(levelAtLeast("[...] INFO  src event=x", "WARN")).toBe(false));
  it("INFO < ERROR", () => expect(levelAtLeast("[...] INFO  src event=x", "ERROR")).toBe(false));
});

describe("afterSince", () => {
  it("returns true when line timestamp >= since", () => {
    const since = new Date("2026-10-22T10:00:00Z");
    expect(afterSince("[2026-10-22 10:00:01] INFO x", since)).toBe(true);
  });

  it("returns false when line timestamp < since", () => {
    const since = new Date("2026-10-22T10:00:02Z");
    expect(afterSince("[2026-10-22 10:00:01] INFO x", since)).toBe(false);
  });
});

describe("parseSince", () => {
  it("parses 1d as ~24h ago", () => {
    const result = parseSince("1d");
    expect(Date.now() - result.getTime()).toBeCloseTo(86400000, -4);
  });

  it("parses 2h as ~2h ago", () => {
    const result = parseSince("2h");
    expect(Date.now() - result.getTime()).toBeCloseTo(7200000, -4);
  });

  it("parses ISO date string", () => {
    const result = parseSince("2026-10-22");
    expect(result.getFullYear()).toBe(2026);
  });
});

describe("filterLines", () => {
  it("no filters returns all lines", () => {
    expect(filterLines(SAMPLE_LINES, {})).toHaveLength(7);
  });

  it("level WARN filters out INFO lines", () => {
    const result = filterLines(SAMPLE_LINES, { level: "WARN" });
    expect(result.every((l) => l.includes("] WARN ") || l.includes("] ERROR "))).toBe(true);
    expect(result).toHaveLength(3);
  });

  it("level ERROR shows only ERROR lines", () => {
    const result = filterLines(SAMPLE_LINES, { level: "ERROR" });
    expect(result.every((l) => l.includes("] ERROR "))).toBe(true);
    expect(result).toHaveLength(1);
  });

  it("tail 3 returns last 3 lines", () => {
    const result = filterLines(SAMPLE_LINES, { tail: 3 });
    expect(result).toHaveLength(3);
    expect(result[0]).toContain("init event=start");
  });

  it("since filters by timestamp", () => {
    const since = new Date("2026-10-23T00:00:00Z");
    const result = filterLines(SAMPLE_LINES, { since });
    expect(result.every((l) => l.startsWith("[2026-10-23"))).toBe(true);
    expect(result).toHaveLength(3);
  });

  it("combined level + tail", () => {
    const result = filterLines(SAMPLE_LINES, { level: "WARN", tail: 2 });
    expect(result).toHaveLength(2);
    // last 2 of [WARN, ERROR, WARN] = [ERROR, WARN]
    expect(result[0]).toContain("] ERROR ");
    expect(result[1]).toContain("] WARN ");
  });
});
