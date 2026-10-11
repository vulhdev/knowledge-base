import { describe, it, expect } from "vitest";
import { createTestDb } from "../setup.js";
import { authCtx, assertAccess } from "../../src/auth/middleware.js";
import { addMember } from "../../src/db/members.js";

function seedWorkspace(db: ReturnType<typeof createTestDb>, name = "ws") {
  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(name);
}

describe("authCtx", () => {
  it("exposes AsyncLocalStorage with getStore/run API", () => {
    expect(typeof authCtx.getStore).toBe("function");
    expect(typeof authCtx.run).toBe("function");
  });

  it("getStore returns undefined outside run()", () => {
    expect(authCtx.getStore()).toBeUndefined();
  });

  it("getStore returns the bound login inside run()", () => {
    let captured: string | undefined;
    authCtx.run({ github_login: "alice" }, () => {
      captured = authCtx.getStore()?.github_login;
    });
    expect(captured).toBe("alice");
  });
});

describe("assertAccess", () => {
  it("throws when no session context is set", () => {
    const db = createTestDb();
    seedWorkspace(db, "secret");
    expect(() => assertAccess(db, "secret")).toThrow(/unauthenticated/i);
  });

  it("throws when user is not a member of the workspace", () => {
    const db = createTestDb();
    seedWorkspace(db, "secret");
    authCtx.run({ github_login: "bob" }, () => {
      expect(() => assertAccess(db, "secret")).toThrow(/forbidden/i);
    });
  });

  it("does not throw when user is a member", () => {
    const db = createTestDb();
    seedWorkspace(db, "myws");
    addMember(db, "alice", "myws");
    authCtx.run({ github_login: "alice" }, () => {
      expect(() => assertAccess(db, "myws")).not.toThrow();
    });
  });

  it("does not throw when server mode is off (no-op in local mode)", () => {
    const db = createTestDb();
    seedWorkspace(db, "myws");
    // No authCtx set, server_mode flag absent → skip auth
    expect(() => assertAccess(db, "myws", { serverMode: false })).not.toThrow();
  });
});
