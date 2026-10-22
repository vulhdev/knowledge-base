import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "../setup.js";
import type Database from "better-sqlite3";
import { insertTeam, listInvites } from "../../src/db/team.js";
import { createWorkspace } from "../../src/db/workspaces.js";
import { generateInvite } from "../../src/team/invite.js";

const HOST_PK = "a".repeat(64);

let db: Database.Database;
let wsId: number;

beforeEach(() => {
  db = createTestDb();
  const ws = createWorkspace(db, "myws");
  wsId = ws.id;
  insertTeam(db, wsId, {
    role: "host",
    secret: "a".repeat(64),
    noise_public_key: HOST_PK,
    noise_secret_key: "b".repeat(64),
    host_public_key: null,
    last_synced_at: null,
  });
});

describe("generateInvite", () => {
  it("returns invite code in <hostPublicKey>:<workspaceName> format", () => {
    const code = generateInvite(db, "myws", "vulhdev");
    expect(code).toBe(`${HOST_PK}:myws`);
  });

  it("SUGG-2: saves pending_invites entry with invited_at as SQLite datetime string", () => {
    generateInvite(db, "myws", "vulhdev");

    const invites = listInvites(db, wsId);
    expect(invites).toHaveLength(1);
    expect(invites[0].github_username).toBe("vulhdev");
    // SQLite datetime('now') → "YYYY-MM-DD HH:MM:SS"
    expect(invites[0].invited_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("saves github username to workspace_invites table", () => {
    generateInvite(db, "myws", "vulhdev");

    const usernames = listInvites(db, wsId).map((i) => i.github_username);
    expect(usernames).toContain("vulhdev");
  });

  it("throws when workspace has no team config", () => {
    const freshDb = createTestDb();
    createWorkspace(freshDb, "myws");

    expect(() => generateInvite(freshDb, "myws", "vulhdev")).toThrow(/no team config/i);
  });

  it("re-inviting same user replaces the existing entry (no duplicate)", () => {
    generateInvite(db, "myws", "vulhdev");
    generateInvite(db, "myws", "vulhdev");

    const invites = listInvites(db, wsId).filter((i) => i.github_username === "vulhdev");
    expect(invites).toHaveLength(1);
  });

  it("throws when caller is not the host", () => {
    const peerDb = createTestDb();
    const peerWs = createWorkspace(peerDb, "myws");
    insertTeam(peerDb, peerWs.id, {
      role: "peer",
      secret: "a".repeat(64),
      noise_public_key: HOST_PK,
      noise_secret_key: "b".repeat(64),
      host_public_key: "h".repeat(64),
      last_synced_at: null,
    });

    expect(() => generateInvite(peerDb, "myws", "vulhdev")).toThrow(/only the host/i);
  });
});
