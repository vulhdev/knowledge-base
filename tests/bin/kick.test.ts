import { describe, it, expect } from "vitest";
import { createTestDb } from "../setup.js";
import { addMember, isMember, removeMember } from "../../src/db/members.js";

describe("kick CLI (via removeMember directly)", () => {
  it("removes a member from workspace", () => {
    const db = createTestDb();
    db.prepare("INSERT INTO workspaces (name) VALUES ('ws')").run();
    addMember(db, "alice", "ws");
    expect(isMember(db, "alice", "ws")).toBe(true);

    removeMember(db, "alice", "ws");

    expect(isMember(db, "alice", "ws")).toBe(false);
  });

  it("does not throw when removing non-existent member", () => {
    const db = createTestDb();
    db.prepare("INSERT INTO workspaces (name) VALUES ('ws')").run();
    expect(() => removeMember(db, "ghost", "ws")).not.toThrow();
  });
});
