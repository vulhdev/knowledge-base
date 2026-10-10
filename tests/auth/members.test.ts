import { describe, it, expect } from "vitest";
import { createTestDb } from "../setup.js";
import { addMember, removeMember, listMembers, isMember } from "../../src/db/members.js";

function seedWorkspace(db: ReturnType<typeof createTestDb>, name = "ws") {
  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(name);
  return (db.prepare("SELECT id FROM workspaces WHERE name = ?").get(name) as { id: number }).id;
}

describe("addMember", () => {
  it("inserts a member row", () => {
    const db = createTestDb();
    const wsId = seedWorkspace(db);
    addMember(db, "alice", "ws");
    const row = db.prepare("SELECT github_login FROM members WHERE workspace_id = ?").get(wsId) as { github_login: string } | undefined;
    expect(row?.github_login).toBe("alice");
  });

  it("is idempotent — calling twice does not throw", () => {
    const db = createTestDb();
    seedWorkspace(db);
    addMember(db, "alice", "ws");
    expect(() => addMember(db, "alice", "ws")).not.toThrow();
  });

  it("stores invited_by when provided", () => {
    const db = createTestDb();
    const wsId = seedWorkspace(db);
    addMember(db, "bob", "ws", "alice");
    const row = db.prepare("SELECT invited_by FROM members WHERE workspace_id = ? AND github_login = 'bob'").get(wsId) as { invited_by: string };
    expect(row.invited_by).toBe("alice");
  });
});

describe("removeMember", () => {
  it("removes an existing member", () => {
    const db = createTestDb();
    const wsId = seedWorkspace(db);
    addMember(db, "alice", "ws");
    removeMember(db, "alice", "ws");
    const count = (db.prepare("SELECT COUNT(*) AS n FROM members WHERE workspace_id = ?").get(wsId) as { n: number }).n;
    expect(count).toBe(0);
  });

  it("is no-op when member does not exist", () => {
    const db = createTestDb();
    seedWorkspace(db);
    expect(() => removeMember(db, "ghost", "ws")).not.toThrow();
  });
});

describe("listMembers", () => {
  it("returns empty array for workspace with no members", () => {
    const db = createTestDb();
    seedWorkspace(db);
    expect(listMembers(db, "ws")).toEqual([]);
  });

  it("returns all members with role, invited_by, created_at", () => {
    const db = createTestDb();
    seedWorkspace(db);
    addMember(db, "alice", "ws", "owner");
    addMember(db, "bob", "ws");
    const members = listMembers(db, "ws");
    expect(members).toHaveLength(2);
    const alice = members.find((m) => m.github_login === "alice");
    expect(alice?.role).toBe("contributor");
    expect(alice?.invited_by).toBe("owner");
    expect(alice?.created_at).toBeTruthy();
  });

  it("returns empty array for non-existent workspace", () => {
    const db = createTestDb();
    expect(listMembers(db, "no-such-workspace")).toEqual([]);
  });
});

describe("isMember", () => {
  it("returns true for existing member", () => {
    const db = createTestDb();
    seedWorkspace(db);
    addMember(db, "alice", "ws");
    expect(isMember(db, "alice", "ws")).toBe(true);
  });

  it("returns false for non-member", () => {
    const db = createTestDb();
    seedWorkspace(db);
    expect(isMember(db, "ghost", "ws")).toBe(false);
  });

  it("returns false for non-existent workspace", () => {
    const db = createTestDb();
    expect(isMember(db, "alice", "nowhere")).toBe(false);
  });
});
