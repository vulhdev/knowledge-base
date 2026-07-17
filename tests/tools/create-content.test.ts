import { describe, it, expect, beforeEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";

describe("createContent", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  it("creates a document and returns id + metadata", () => {
    const result = createContent(db, "my-project", "auth", "idea", "some idea");
    expect(result.id).toBeTypeOf("number");
    expect(result.workspace).toBe("my-project");
    expect(result.feature).toBe("auth");
    expect(result.type).toBe("idea");
    expect(result.created_at).toBeTruthy();
  });

  it("auto-creates workspace and feature if they don't exist", () => {
    createContent(db, "new-ws", "new-ft", "spec", "spec body");
    expect(db.prepare("SELECT id FROM workspaces WHERE name = ?").get("new-ws")).toBeTruthy();
    expect(db.prepare("SELECT id FROM features WHERE name = ?").get("new-ft")).toBeTruthy();
  });

  it("reuses existing workspace and feature", () => {
    createContent(db, "ws", "ft", "idea", "first");
    createContent(db, "ws", "ft", "idea", "second");
    const workspaces = db.prepare("SELECT id FROM workspaces WHERE name = ?").all("ws");
    expect(workspaces).toHaveLength(1);
    const features = db.prepare("SELECT id FROM features WHERE name = ?").all("ft");
    expect(features).toHaveLength(1);
  });

  it("accepts any non-empty string as type", () => {
    const result = createContent(db, "ws", "ft", "issue" as any, "body");
    expect(result.type).toBe("issue");
  });

  it("accepts custom type adr", () => {
    const result = createContent(db, "ws", "ft", "adr" as any, "body");
    expect(result.type).toBe("adr");
  });

  it("throws for empty body", () => {
    expect(() => createContent(db, "ws", "ft", "idea", "")).toThrow(/body must not be empty/);
    expect(() => createContent(db, "ws", "ft", "idea", "   ")).toThrow(/body must not be empty/);
  });

  it("FTS index contains the new body after insert", () => {
    createContent(db, "ws", "ft", "idea", "unique keyword xyzzy");
    const rows = db.prepare("SELECT rowid FROM contents_fts WHERE contents_fts MATCH ?").all("xyzzy");
    expect(rows).toHaveLength(1);
  });

  it("supports all valid content types", () => {
    for (const type of ["idea", "spec", "plan", "digest", "doc"] as const) {
      const r = createContent(db, "ws", type, type, `body for ${type}`);
      expect(r.type).toBe(type);
    }
  });

  it("returns title when provided", () => {
    const result = createContent(db, "ws", "ft", "doc", "body text", "My Doc Title");
    expect(result.title).toBe("My Doc Title");
  });

  it("returns null title when not provided", () => {
    const result = createContent(db, "ws", "ft", "idea", "body text");
    expect(result.title).toBeNull();
  });

  it("allows multiple doc rows in the same feature", () => {
    createContent(db, "ws", "ft", "doc", "db schema doc", "DB Schema");
    createContent(db, "ws", "ft", "doc", "backend flow doc", "Backend Flow");
    const rows = db.prepare("SELECT id FROM contents WHERE type = 'doc'").all();
    expect(rows).toHaveLength(2);
  });
});
