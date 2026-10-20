import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "../setup.js";

vi.mock("hyperswarm", () => ({
  default: vi.fn().mockImplementation(() => ({
    join: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  })),
}));

vi.mock("../../src/config.js", () => ({
  loadSettings: vi.fn(),
  writeSettings: vi.fn(),
}));

const TEAM_SETTINGS = {
  db_path: "/db",
  model_cache_dir: "/m",
  workspaces: {
    myws: {
      team: {
        role: "host" as const,
        secret: "a".repeat(64),
        noise_keypair: { publicKey: "b".repeat(64), secretKey: "c".repeat(64) },
      },
    },
  },
};

describe("startSyncIfConfigured", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns null when no workspaces in settings", async () => {
    const { loadSettings } = await import("../../src/config.js");
    vi.mocked(loadSettings).mockReturnValue({ db_path: "/db", model_cache_dir: "/m" });
    const db = createTestDb();
    const { startSyncIfConfigured } = await import("../../src/sync/boot.js");
    expect(startSyncIfConfigured(db)).toBeNull();
  });

  it("returns null when workspace has no team config", async () => {
    const { loadSettings } = await import("../../src/config.js");
    vi.mocked(loadSettings).mockReturnValue({
      db_path: "/db",
      model_cache_dir: "/m",
      workspaces: { myws: {} },
    });
    const db = createTestDb();
    const { startSyncIfConfigured } = await import("../../src/sync/boot.js");
    expect(startSyncIfConfigured(db)).toBeNull();
  });

  it("starts sync and returns a handle when team config exists", async () => {
    const { loadSettings } = await import("../../src/config.js");
    vi.mocked(loadSettings).mockReturnValue(TEAM_SETTINGS);
    const db = createTestDb();
    const { startSyncIfConfigured } = await import("../../src/sync/boot.js");
    const handle = startSyncIfConfigured(db);
    expect(handle).not.toBeNull();
    expect(typeof handle!.destroy).toBe("function");
    await handle!.destroy();
  });
});
