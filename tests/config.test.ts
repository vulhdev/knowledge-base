import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:os", () => ({ homedir: vi.fn().mockReturnValue("/test/home") }));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  chmodSync: vi.fn(),
  renameSync: vi.fn(),
  copyFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

describe("loadSettings", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.DB_PATH;
    delete process.env.MODEL_CACHE_DIR;
  });

  it("returns parsed settings when settings.json exists", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ db_path: "/custom/db.db", model_cache_dir: "/custom/models" }),
    );

    const { loadSettings } = await import("../src/config.js");
    const s = loadSettings();

    expect(s.db_path).toBe("/custom/db.db");
    expect(s.model_cache_dir).toBe("/custom/models");
  });

  it("writes defaults when settings.json missing and no env vars", async () => {
    const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(false);

    const { loadSettings } = await import("../src/config.js");
    const s = loadSettings();

    expect(s.db_path).toBe("/test/home/.claude/knowledge-base/knowledge-base.db");
    expect(s.model_cache_dir).toBe("/test/home/.cache/knowledge-base/models");
    expect(mkdirSync).toHaveBeenCalledWith("/test/home/.claude/knowledge-base", { recursive: true });
    expect(writeFileSync).toHaveBeenCalled();
  });

  it("uses DB_PATH env var as db_path when settings.json missing", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(false);
    process.env.DB_PATH = "/env/custom.db";

    const { loadSettings } = await import("../src/config.js");
    const s = loadSettings();

    expect(s.db_path).toBe("/env/custom.db");
  });

  it("uses MODEL_CACHE_DIR env var as model_cache_dir when settings.json missing", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(false);
    process.env.MODEL_CACHE_DIR = "/env/models";

    const { loadSettings } = await import("../src/config.js");
    const s = loadSettings();

    expect(s.model_cache_dir).toBe("/env/models");
  });

  it("calls renameSync to move legacy DB when it exists", async () => {
    const { existsSync, renameSync } = await import("node:fs");
    vi.mocked(existsSync).mockImplementation((p) =>
      p === "/test/home/.claude/knowledge-base.db",
    );

    const { loadSettings } = await import("../src/config.js");
    loadSettings();

    expect(renameSync).toHaveBeenCalledWith(
      "/test/home/.claude/knowledge-base.db",
      "/test/home/.claude/knowledge-base/knowledge-base.db",
    );
  });

  it("returns cached value on second call without re-reading the file", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ db_path: "/cached/db.db", model_cache_dir: "/cached/models" }),
    );

    const { loadSettings } = await import("../src/config.js");
    loadSettings();
    loadSettings();

    expect(readFileSync).toHaveBeenCalledTimes(1);
  });
});

describe("writeSettings", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("writes serialized settings to tmp path then renames atomically", async () => {
    const { writeFileSync, renameSync } = await import("node:fs");
    const { writeSettings } = await import("../src/config.js");

    const settings = {
      db_path: "/some/db.db",
      model_cache_dir: "/some/models",
    };
    writeSettings(settings);

    const tmp = "/test/home/.claude/knowledge-base/settings.json.tmp";
    const final = "/test/home/.claude/knowledge-base/settings.json";
    expect(writeFileSync).toHaveBeenCalledWith(tmp, JSON.stringify(settings, null, 2));
    expect(renameSync).toHaveBeenCalledWith(tmp, final);
  });

  it("sets chmod 600 on tmp file before rename", async () => {
    const { chmodSync } = await import("node:fs");
    const { writeSettings } = await import("../src/config.js");

    writeSettings({ db_path: "/db", model_cache_dir: "/m" });

    expect(chmodSync).toHaveBeenCalledWith(
      "/test/home/.claude/knowledge-base/settings.json.tmp",
      0o600,
    );
  });

  it("invalidates cache so next loadSettings re-reads from disk", async () => {
    const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
    const { loadSettings, writeSettings } = await import("../src/config.js");

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ db_path: "/first.db", model_cache_dir: "/m" }),
    );

    loadSettings(); // populate cache
    writeSettings({ db_path: "/second.db", model_cache_dir: "/m" }); // invalidate cache

    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ db_path: "/second.db", model_cache_dir: "/m" }),
    );
    const s = loadSettings();

    expect(readFileSync).toHaveBeenCalledTimes(2);
    expect(s.db_path).toBe("/second.db");
  });

  it("persists team config with identity and workspace team settings", async () => {
    const { writeFileSync } = await import("node:fs");
    const { writeSettings } = await import("../src/config.js");

    const settings = {
      db_path: "/db",
      model_cache_dir: "/m",
      identity: { name: "Alice", email: "alice@example.com" },
      workspaces: {
        "my-project": {
          team: {
            role: "host" as const,
            secret: "a".repeat(64),
            noise_keypair: { publicKey: "b".repeat(64), secretKey: "c".repeat(64) },
            pending_github_usernames: ["alice"],
          },
        },
      },
    };
    writeSettings(settings);

    const written = JSON.parse(
      vi.mocked(writeFileSync).mock.calls[0][1] as string,
    );
    expect(written.identity.name).toBe("Alice");
    expect(written.workspaces["my-project"].team.role).toBe("host");
    expect(written.workspaces["my-project"].team.secret).toBe("a".repeat(64));
  });
});
