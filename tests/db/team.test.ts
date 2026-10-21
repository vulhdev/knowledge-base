import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import {
  getTeamByName,
  listTeamWorkspaces,
  insertTeam,
  updateLastSynced,
  addInvite,
  removeInvite,
  listInvites,
  type WorkspaceTeamRow,
} from "../../src/db/team.js";

function seedWorkspace(db: Database.Database, name: string): number {
  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(name);
  return (db.prepare("SELECT id FROM workspaces WHERE name = ?").get(name) as { id: number }).id;
}

const BASE_TEAM: Omit<WorkspaceTeamRow, "workspace_id"> = {
  role: "host",
  secret: "abc123secret",
  noise_public_key: "pubkey_hex",
  noise_secret_key: "seckey_hex",
  host_public_key: null,
  last_synced_at: null,
};

describe("getTeamByName", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("returns null for unknown workspace", () => {
    expect(getTeamByName(db, "missing")).toBeNull();
  });

  it("returns null for solo workspace (no team row)", () => {
    seedWorkspace(db, "solo");
    expect(getTeamByName(db, "solo")).toBeNull();
  });

  it("returns team row for team workspace", () => {
    const wsId = seedWorkspace(db, "ws");
    insertTeam(db, wsId, BASE_TEAM);
    const row = getTeamByName(db, "ws");
    expect(row).not.toBeNull();
    expect(row!.role).toBe("host");
    expect(row!.secret).toBe("abc123secret");
    expect(row!.workspace_id).toBe(wsId);
  });

  it("returns host_public_key when set", () => {
    const wsId = seedWorkspace(db, "ws");
    insertTeam(db, wsId, { ...BASE_TEAM, role: "peer", host_public_key: "hostpubkey" });
    const row = getTeamByName(db, "ws");
    expect(row!.host_public_key).toBe("hostpubkey");
  });
});

describe("listTeamWorkspaces", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("returns empty array when no team workspaces", () => {
    seedWorkspace(db, "solo");
    expect(listTeamWorkspaces(db)).toEqual([]);
  });

  it("returns only team workspaces sorted by name", () => {
    const ws1 = seedWorkspace(db, "beta");
    const ws2 = seedWorkspace(db, "alpha");
    seedWorkspace(db, "solo");
    insertTeam(db, ws1, BASE_TEAM);
    insertTeam(db, ws2, BASE_TEAM);

    const rows = listTeamWorkspaces(db);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("alpha");
    expect(rows[1].name).toBe("beta");
  });

  it("includes name field alongside team row fields", () => {
    const wsId = seedWorkspace(db, "myws");
    insertTeam(db, wsId, BASE_TEAM);
    const rows = listTeamWorkspaces(db);
    expect(rows[0].name).toBe("myws");
    expect(rows[0].role).toBe("host");
  });
});

describe("insertTeam", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("inserts a host team row", () => {
    const wsId = seedWorkspace(db, "ws");
    insertTeam(db, wsId, BASE_TEAM);
    const row = getTeamByName(db, "ws");
    expect(row).not.toBeNull();
    expect(row!.role).toBe("host");
  });

  it("inserts a peer team row with host_public_key", () => {
    const wsId = seedWorkspace(db, "ws");
    insertTeam(db, wsId, { ...BASE_TEAM, role: "peer", host_public_key: "hostpk" });
    const row = getTeamByName(db, "ws");
    expect(row!.role).toBe("peer");
    expect(row!.host_public_key).toBe("hostpk");
  });

  it("throws on duplicate workspace_id", () => {
    const wsId = seedWorkspace(db, "ws");
    insertTeam(db, wsId, BASE_TEAM);
    expect(() => insertTeam(db, wsId, BASE_TEAM)).toThrow();
  });
});

describe("updateLastSynced", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("updates last_synced_at for the workspace", () => {
    const wsId = seedWorkspace(db, "ws");
    insertTeam(db, wsId, BASE_TEAM);
    updateLastSynced(db, wsId, "2026-01-01T12:00:00.000Z");
    const row = getTeamByName(db, "ws");
    expect(row!.last_synced_at).toBe("2026-01-01T12:00:00.000Z");
  });

  it("is a no-op for unknown workspace_id", () => {
    expect(() => updateLastSynced(db, 9999, "2026-01-01T12:00:00.000Z")).not.toThrow();
  });
});

describe("addInvite / removeInvite / listInvites", () => {
  let db: Database.Database;
  let wsId: number;
  beforeEach(() => {
    db = createTestDb();
    wsId = seedWorkspace(db, "ws");
  });

  it("listInvites returns empty for workspace with no invites", () => {
    expect(listInvites(db, wsId)).toEqual([]);
  });

  it("addInvite adds a row, listInvites returns it", () => {
    addInvite(db, wsId, "alice");
    const invites = listInvites(db, wsId);
    expect(invites).toHaveLength(1);
    expect(invites[0].github_username).toBe("alice");
    expect(invites[0].workspace_id).toBe(wsId);
  });

  it("addInvite is idempotent — upserts on duplicate", () => {
    addInvite(db, wsId, "alice");
    addInvite(db, wsId, "alice");
    expect(listInvites(db, wsId)).toHaveLength(1);
  });

  it("addInvite updates invited_at on upsert", () => {
    addInvite(db, wsId, "alice");
    const first = listInvites(db, wsId)[0].invited_at;
    addInvite(db, wsId, "alice");
    const second = listInvites(db, wsId)[0].invited_at;
    expect(second >= first).toBe(true);
  });

  it("removeInvite removes the row", () => {
    addInvite(db, wsId, "bob");
    removeInvite(db, wsId, "bob");
    expect(listInvites(db, wsId)).toHaveLength(0);
  });

  it("removeInvite is safe for non-existent invite", () => {
    expect(() => removeInvite(db, wsId, "nobody")).not.toThrow();
  });

  it("multiple invites for same workspace are independent", () => {
    addInvite(db, wsId, "alice");
    addInvite(db, wsId, "bob");
    removeInvite(db, wsId, "alice");
    const remaining = listInvites(db, wsId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].github_username).toBe("bob");
  });

  it("invites are scoped per workspace", () => {
    const ws2 = seedWorkspace(db, "ws2");
    addInvite(db, wsId, "alice");
    expect(listInvites(db, ws2)).toHaveLength(0);
  });
});
