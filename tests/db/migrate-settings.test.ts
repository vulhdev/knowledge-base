import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "../setup.js";
import { getTeamByName, listInvites } from "../../src/db/team.js";
import { createWorkspace } from "../../src/db/workspaces.js";

const mockLoadSettings = vi.fn();
const mockWriteSettings = vi.fn();

vi.mock("../../src/config.js", () => ({
  loadSettings: () => mockLoadSettings(),
  writeSettings: (s: unknown) => mockWriteSettings(s),
}));

vi.mock("../../src/embedding/backfill.js", () => ({ startBackfill: vi.fn() }));

describe("migrateSettingsToDb", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("migrates workspace team config from legacy settings.json into workspace_team", async () => {
    mockLoadSettings.mockReturnValue({
      db_path: "/db",
      model_cache_dir: "/m",
      workspaces: {
        "my-ws": {
          team: {
            role: "host",
            secret: "s".repeat(64),
            noise_keypair: { publicKey: "p".repeat(64), secretKey: "k".repeat(128) },
            host_public_key: null,
            last_synced_at: null,
          },
        },
      },
    });

    const db = createTestDb();
    const { migrateSettingsToDb } = await import("../../src/db/client.js");
    migrateSettingsToDb(db);

    const team = getTeamByName(db, "my-ws");
    expect(team).not.toBeNull();
    expect(team?.role).toBe("host");
    expect(team?.secret).toBe("s".repeat(64));
    expect(team?.noise_public_key).toBe("p".repeat(64));
    expect(team?.noise_secret_key).toBe("k".repeat(128));
  });

  it("migrates pending_github_usernames to workspace_invites", async () => {
    mockLoadSettings.mockReturnValue({
      db_path: "/db",
      model_cache_dir: "/m",
      workspaces: {
        "my-ws": {
          team: {
            role: "host",
            secret: "s".repeat(64),
            noise_keypair: { publicKey: "p".repeat(64), secretKey: "k".repeat(128) },
            pending_github_usernames: ["alice", "bob"],
          },
        },
      },
    });

    const db = createTestDb();
    const { migrateSettingsToDb } = await import("../../src/db/client.js");
    migrateSettingsToDb(db);

    const team = getTeamByName(db, "my-ws")!;
    const invites = listInvites(db, team.workspace_id);
    expect(invites.map((i) => i.github_username)).toEqual(expect.arrayContaining(["alice", "bob"]));
  });

  it("removes workspaces from settings.json after migration", async () => {
    mockLoadSettings.mockReturnValue({
      db_path: "/db",
      model_cache_dir: "/m",
      workspaces: {
        "my-ws": {
          team: {
            role: "host",
            secret: "s".repeat(64),
            noise_keypair: { publicKey: "p".repeat(64), secretKey: "k".repeat(128) },
          },
        },
      },
    });

    const db = createTestDb();
    const { migrateSettingsToDb } = await import("../../src/db/client.js");
    migrateSettingsToDb(db);

    expect(mockWriteSettings).toHaveBeenCalledOnce();
    const saved = mockWriteSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(saved).not.toHaveProperty("workspaces");
    expect(saved.db_path).toBe("/db");
  });

  it("skips migration when settings has no workspaces key", async () => {
    mockLoadSettings.mockReturnValue({ db_path: "/db", model_cache_dir: "/m" });

    const db = createTestDb();
    const { migrateSettingsToDb } = await import("../../src/db/client.js");
    migrateSettingsToDb(db);

    expect(mockWriteSettings).not.toHaveBeenCalled();
  });

  it("skips already-migrated workspaces on second run", async () => {
    mockLoadSettings.mockReturnValue({
      db_path: "/db",
      model_cache_dir: "/m",
      workspaces: {
        "my-ws": {
          team: {
            role: "host",
            secret: "s".repeat(64),
            noise_keypair: { publicKey: "p".repeat(64), secretKey: "k".repeat(128) },
          },
        },
      },
    });

    const db = createTestDb();
    const ws = createWorkspace(db, "my-ws");
    // Pre-seed the team row to simulate already-migrated
    const { insertTeam } = await import("../../src/db/team.js");
    insertTeam(db, ws.id, {
      role: "host",
      secret: "s".repeat(64),
      noise_public_key: "p".repeat(64),
      noise_secret_key: "k".repeat(128),
      host_public_key: null,
      last_synced_at: null,
    });

    const { migrateSettingsToDb } = await import("../../src/db/client.js");
    migrateSettingsToDb(db);

    // writeSettings should NOT be called since nothing was actually migrated
    expect(mockWriteSettings).not.toHaveBeenCalled();
  });
});
