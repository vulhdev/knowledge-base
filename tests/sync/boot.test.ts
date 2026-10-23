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

describe("startSyncIfConfigured — multiple workspaces", () => {
  it("[CRITICAL-CR] starts sync for ALL configured workspaces, not just the first", async () => {
    const db = createTestDb();

    const ws1 = createWorkspace(db, "alpha");
    insertTeam(db, ws1.id, {
      role: "host",
      secret: "a".repeat(64),
      noise_public_key: "b".repeat(64),
      noise_secret_key: "c".repeat(64),
      host_public_key: null,
      last_synced_at: null,
    });

    const ws2 = createWorkspace(db, "beta");
    insertTeam(db, ws2.id, {
      role: "peer",
      secret: "d".repeat(64),
      noise_public_key: "e".repeat(64),
      noise_secret_key: "f".repeat(64),
      host_public_key: "g".repeat(64),
      last_synced_at: null,
    });

    const { startSyncIfConfigured } = await import("../../src/sync/boot.js");
    const handles = startSyncIfConfigured(db);

    // Must return an array (or composite) covering both workspaces
    expect(Array.isArray(handles)).toBe(true);
    expect((handles as unknown[]).length).toBe(2);

    // Clean up
    for (const h of (handles as { destroy: () => Promise<void> }[])) {
      await h.destroy();
    }
  });
});

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

  it("starts sync and returns an array of handles when team config exists", async () => {
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
    const handles = startSyncIfConfigured(db);
    expect(handles).not.toBeNull();
    expect(Array.isArray(handles)).toBe(true);
    expect(handles!.length).toBe(1);
    expect(typeof handles![0].destroy).toBe("function");
    await handles![0].destroy();
  });
});
