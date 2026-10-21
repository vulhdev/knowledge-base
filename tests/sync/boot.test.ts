import { describe, it, expect, vi } from "vitest";
import { createTestDb } from "../setup.js";
import { insertTeam } from "../../src/db/team.js";
import { createWorkspace } from "../../src/db/workspaces.js";

vi.mock("hyperswarm", () => ({
  default: vi.fn().mockImplementation(() => ({
    join: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  })),
}));

describe("startSyncIfConfigured", () => {
  it("returns null when no team workspaces in DB", async () => {
    const db = createTestDb();
    const { startSyncIfConfigured } = await import("../../src/sync/boot.js");
    expect(startSyncIfConfigured(db)).toBeNull();
  });

  it("returns null when workspace exists but has no team row", async () => {
    const db = createTestDb();
    createWorkspace(db, "myws");
    const { startSyncIfConfigured } = await import("../../src/sync/boot.js");
    expect(startSyncIfConfigured(db)).toBeNull();
  });

  it("starts sync and returns a handle when team config exists", async () => {
    const db = createTestDb();
    const ws = createWorkspace(db, "myws2");
    insertTeam(db, ws.id, {
      role: "host",
      secret: "a".repeat(64),
      noise_public_key: "b".repeat(64),
      noise_secret_key: "c".repeat(64),
      host_public_key: null,
      last_synced_at: null,
    });
    const { startSyncIfConfigured } = await import("../../src/sync/boot.js");
    const handle = startSyncIfConfigured(db);
    expect(handle).not.toBeNull();
    expect(typeof handle!.destroy).toBe("function");
    await handle!.destroy();
  });
});
