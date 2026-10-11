import { describe, it, expect } from "vitest";
import { createTestDb } from "../setup.js";
import { createSession, validateSession } from "../../src/auth/sessions.js";

describe("createSession", () => {
  it("returns a 64-char hex string", () => {
    const db = createTestDb();
    const raw = createSession(db, "alice");
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores a hash in DB that differs from raw token", () => {
    const db = createTestDb();
    const raw = createSession(db, "alice");
    const row = db.prepare("SELECT token_hash FROM sessions WHERE github_login = 'alice'").get() as { token_hash: string };
    expect(row.token_hash).not.toBe(raw);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores correct github_login and future expires_at", () => {
    const db = createTestDb();
    createSession(db, "bob");
    const row = db.prepare("SELECT github_login, expires_at FROM sessions WHERE github_login = 'bob'").get() as { github_login: string; expires_at: string };
    expect(row.github_login).toBe("bob");
    expect(new Date(row.expires_at) > new Date()).toBe(true);
  });
});

describe("validateSession", () => {
  it("returns { github_login } for a valid token", () => {
    const db = createTestDb();
    const raw = createSession(db, "alice");
    const result = validateSession(db, raw);
    expect(result).toEqual({ github_login: "alice" });
  });

  it("returns null for unknown token", () => {
    const db = createTestDb();
    expect(validateSession(db, "deadbeef")).toBeNull();
  });

  it("returns null for undefined", () => {
    const db = createTestDb();
    expect(validateSession(db, undefined)).toBeNull();
  });

  it("returns null for expired session", () => {
    const db = createTestDb();
    const raw = createSession(db, "alice");
    // Manually expire
    db.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 second') WHERE github_login = 'alice'").run();
    expect(validateSession(db, raw)).toBeNull();
  });
});
