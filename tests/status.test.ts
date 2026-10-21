import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb } from "./setup.js";
import { createWorkspace } from "../src/db/workspaces.js";
import { insertTeam } from "../src/db/team.js";

vi.mock("hyperswarm", () => ({
  default: vi.fn().mockImplementation(() => ({
    join: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  })),
}));

vi.mock("@clack/prompts", () => ({
  spinner: vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() }),
  select: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
  cancel: vi.fn(),
}));

describe("formatTimeAgoForTest", () => {
  beforeEach(() => vi.resetModules());

  it("returns seconds for sub-minute timestamps", async () => {
    const { formatTimeAgoForTest } = await import("../src/bin/status.js");
    const ts = new Date(Date.now() - 30_000).toISOString();
    expect(formatTimeAgoForTest(ts)).toBe("30 seconds ago");
  });

  it("returns minutes for ~2 minute old timestamps", async () => {
    const { formatTimeAgoForTest } = await import("../src/bin/status.js");
    const ts = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    expect(formatTimeAgoForTest(ts)).toBe("2 minutes ago");
  });

  it("returns hours for ~3 hour old timestamps", async () => {
    const { formatTimeAgoForTest } = await import("../src/bin/status.js");
    const ts = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatTimeAgoForTest(ts)).toBe("3 hours ago");
  });

  it("returns days for >24h old timestamps", async () => {
    const { formatTimeAgoForTest } = await import("../src/bin/status.js");
    const ts = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatTimeAgoForTest(ts)).toBe("2 days ago");
  });
});

describe("resolveWorkspaceForTest", () => {
  let originalArgv: string[];

  beforeEach(() => {
    vi.resetModules();
    originalArgv = process.argv;
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("returns null and prints message when workspace arg has no team config", async () => {
    process.argv = ["node", "cli.js", "status", "myws"];
    const db = createTestDb();
    createWorkspace(db, "myws"); // workspace exists but no team row
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { resolveWorkspaceForTest } = await import("../src/bin/status.js");
    const result = await resolveWorkspaceForTest(db);
    expect(result).toBeNull();
    expect(logSpy.mock.calls.flat().join(" ")).toMatch(/no team mode/i);
    logSpy.mockRestore();
  });

  it("returns null and prints message when no workspaces are team-configured", async () => {
    process.argv = ["node", "cli.js", "status"];
    const db = createTestDb(); // empty DB — no team workspaces
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { resolveWorkspaceForTest } = await import("../src/bin/status.js");
    const result = await resolveWorkspaceForTest(db);
    expect(result).toBeNull();
    expect(logSpy.mock.calls.flat().join(" ")).toMatch(/no workspaces/i);
    logSpy.mockRestore();
  });

  it("auto-selects when exactly one team workspace exists and no arg given", async () => {
    process.argv = ["node", "cli.js", "status"];
    const db = createTestDb();
    const ws = createWorkspace(db, "myws");
    insertTeam(db, ws.id, {
      role: "host",
      secret: "a".repeat(64),
      noise_public_key: "b".repeat(64),
      noise_secret_key: "c".repeat(128),
      host_public_key: null,
      last_synced_at: null,
    });

    const { resolveWorkspaceForTest } = await import("../src/bin/status.js");
    const result = await resolveWorkspaceForTest(db);
    expect(result).toBe("myws");
  });

  it("returns the workspace when a valid team arg is provided", async () => {
    process.argv = ["node", "cli.js", "status", "myws"];
    const db = createTestDb();
    const ws = createWorkspace(db, "myws");
    insertTeam(db, ws.id, {
      role: "peer",
      secret: "a".repeat(64),
      noise_public_key: "b".repeat(64),
      noise_secret_key: "c".repeat(128),
      host_public_key: "h".repeat(64),
      last_synced_at: null,
    });

    const { resolveWorkspaceForTest } = await import("../src/bin/status.js");
    const result = await resolveWorkspaceForTest(db);
    expect(result).toBe("myws");
  });
});
