import { describe, it, expect } from "vitest";
import { createTestDb } from "../setup.js";
import { addMember, removeMember, listMembers, isMember, isWorkspaceAdmin } from "../../src/db/members.js";

function seedWorkspace(db: ReturnType<typeof createTestDb>, name = "ws") {
  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(name);
  return (db.prepare("SELECT id FROM workspaces WHERE name = ?").get(name) as { id: number }).id;
}

describe("addMember — role param", () => {
  it("stores role=admin when passed", () => {
    const db = createTestDb();
    addMember(db, "alice", "ws", undefined, "admin");
    const wsId = (db.prepare("SELECT id FROM workspaces WHERE name = 'ws'").get() as { id: number }).id;
    const row = db.prepare("SELECT role FROM members WHERE github_login = 'alice' AND workspace_id = ?").get(wsId) as { role: string };
    expect(row.role).toBe("admin");
  });

  it("defaults to contributor when role is omitted", () => {
    const db = createTestDb();
    addMember(db, "bob", "ws");
    const wsId = (db.prepare("SELECT id FROM workspaces WHERE name = 'ws'").get() as { id: number }).id;
    const row = db.prepare("SELECT role FROM members WHERE github_login = 'bob' AND workspace_id = ?").get(wsId) as { role: string };
    expect(row.role).toBe("contributor");
  });
});

describe("isWorkspaceAdmin", () => {
  it("returns true when user has role=admin in workspace", () => {
    const db = createTestDb();
    addMember(db, "alice", "ws", undefined, "admin");
    expect(isWorkspaceAdmin(db, "alice", "ws")).toBe(true);
  });

  it("returns false when user is contributor", () => {
    const db = createTestDb();
    addMember(db, "alice", "ws");
    expect(isWorkspaceAdmin(db, "alice", "ws")).toBe(false);
  });

  it("returns false for non-existent workspace", () => {
    const db = createTestDb();
    expect(isWorkspaceAdmin(db, "alice", "nowhere")).toBe(false);
  });

  it("returns false when user is not a member", () => {
    const db = createTestDb();
    db.prepare("INSERT INTO workspaces (name) VALUES ('ws')").run();
    expect(isWorkspaceAdmin(db, "ghost", "ws")).toBe(false);
  });

  it("is per-workspace — admin in one workspace, not in another", () => {
    const db = createTestDb();
    addMember(db, "alice", "ws1", undefined, "admin");
    addMember(db, "alice", "ws2");
    expect(isWorkspaceAdmin(db, "alice", "ws1")).toBe(true);
    expect(isWorkspaceAdmin(db, "alice", "ws2")).toBe(false);
  });
});

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
