import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

vi.mock("node:os", () => ({ homedir: vi.fn().mockReturnValue("/test/home") }));
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  chmodSync: vi.fn(),
  renameSync: vi.fn(),
  copyFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

const BASE_SETTINGS = { db_path: "/db", model_cache_dir: "/m" };

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

  beforeEach(async () => {
    vi.resetModules();
    originalArgv = process.argv;
    // Re-apply homedir mock after resetModules (Node built-ins are not re-imported)
    const { homedir } = await import("node:os");
    vi.mocked(homedir).mockReturnValue("/test/home");
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("returns null and prints message when workspace arg has no team config", async () => {
    process.argv = ["node", "cli.js", "status", "myws"];
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ ...BASE_SETTINGS, workspaces: { myws: {} } }),
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { resolveWorkspaceForTest } = await import("../src/bin/status.js");
    const result = await resolveWorkspaceForTest();
    expect(result).toBeNull();
    expect(logSpy.mock.calls.flat().join(" ")).toMatch(/no team mode/i);
    logSpy.mockRestore();
  });

  it("returns null and prints message when no workspaces are team-configured", async () => {
    process.argv = ["node", "cli.js", "status"];
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(BASE_SETTINGS));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { resolveWorkspaceForTest } = await import("../src/bin/status.js");
    const result = await resolveWorkspaceForTest();
    expect(result).toBeNull();
    expect(logSpy.mock.calls.flat().join(" ")).toMatch(/no workspaces/i);
    logSpy.mockRestore();
  });

  it("auto-selects when exactly one team workspace exists and no arg given", async () => {
    process.argv = ["node", "cli.js", "status"];
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        ...BASE_SETTINGS,
        workspaces: {
          myws: { team: { role: "host", secret: "a".repeat(64), noise_keypair: { publicKey: "b".repeat(64), secretKey: "c".repeat(64) } } },
        },
      }),
    );

    const { resolveWorkspaceForTest } = await import("../src/bin/status.js");
    const result = await resolveWorkspaceForTest();
    expect(result).toBe("myws");
  });

  it("returns the workspace when a valid team arg is provided", async () => {
    process.argv = ["node", "cli.js", "status", "myws"];
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        ...BASE_SETTINGS,
        workspaces: {
          myws: { team: { role: "peer", secret: "a".repeat(64), noise_keypair: { publicKey: "b".repeat(64), secretKey: "c".repeat(64) } } },
        },
      }),
    );

    const { resolveWorkspaceForTest } = await import("../src/bin/status.js");
    const result = await resolveWorkspaceForTest();
    expect(result).toBe("myws");
  });
});
