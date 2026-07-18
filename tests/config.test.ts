import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:os", () => ({ homedir: vi.fn().mockReturnValue("/test/home") }));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
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
});
