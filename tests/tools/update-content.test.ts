import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { updateContent } from "../../src/tools/update-content.js";

describe("updateContent", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("updates body and returns the full document", () => {
    const created = createContent(db, "proj", "auth", "idea", "original body");
    const result = updateContent(db, created.id, "revised body");
    expect(result.id).toBe(created.id);
    expect(result.body).toBe("revised body");
    expect(result.type).toBe("idea");
    expect(result.workspace).toBe("proj");
    expect(result.feature).toBe("auth");
    expect(result.created_at).toBe(created.created_at);
    expect(result.updated_at).toBeTruthy();
  });

  it("updates body and type when type is provided", () => {
    const created = createContent(db, "proj", "auth", "idea", "original body");
    const result = updateContent(db, created.id, "now a spec", "spec");
    expect(result.type).toBe("spec");
    expect(result.body).toBe("now a spec");
  });

  it("preserves existing type when type is not provided", () => {
    const created = createContent(db, "proj", "auth", "plan", "plan body");
    const result = updateContent(db, created.id, "updated plan body");
    expect(result.type).toBe("plan");
  });

  it("throws for unknown id", () => {
    expect(() => updateContent(db, 999, "body")).toThrow(/not found.*999/i);
  });

  it("throws for empty body", () => {
    const created = createContent(db, "proj", "auth", "idea", "body");
    expect(() => updateContent(db, created.id, "")).toThrow(/body must not be empty/);
    expect(() => updateContent(db, created.id, "   ")).toThrow(/body must not be empty/);
  });

  it("accepts custom type string", () => {
    const created = createContent(db, "proj", "auth", "idea", "body");
    const result = updateContent(db, created.id, "body", "issue" as any);
    expect(result.type).toBe("issue");
  });

  it("updates title when provided", () => {
    const created = createContent(db, "proj", "auth", "doc", "body", "Old Title");
    const result = updateContent(db, created.id, "body", undefined, "New Title");
    expect(result.title).toBe("New Title");
  });

  it("preserves existing title when title is omitted", () => {
    const created = createContent(db, "proj", "auth", "doc", "body", "Keep This");
    const result = updateContent(db, created.id, "updated body");
    expect(result.title).toBe("Keep This");
  });

  it("title is null when never set and not updated", () => {
    const created = createContent(db, "proj", "auth", "idea", "body");
    const result = updateContent(db, created.id, "updated body");
    expect(result.title).toBeNull();
  });

  it("accepts doc type", () => {
    const created = createContent(db, "proj", "auth", "idea", "body");
    const result = updateContent(db, created.id, "body", "doc");
    expect(result.type).toBe("doc");
  });

  it("FTS reflects new body after update", () => {
    const created = createContent(db, "proj", "auth", "idea", "old keyword alphazulu");
    updateContent(db, created.id, "new keyword betafox");
    const oldMatch = db.prepare("SELECT rowid FROM contents_fts WHERE contents_fts MATCH ?").all("alphazulu");
    const newMatch = db.prepare("SELECT rowid FROM contents_fts WHERE contents_fts MATCH ?").all("betafox");
    expect(oldMatch).toHaveLength(0);
    expect(newMatch).toHaveLength(1);
  });
});
