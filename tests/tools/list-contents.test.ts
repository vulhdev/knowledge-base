import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { listContents } from "../../src/tools/list-contents.js";

describe("listContents", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    createContent(db, "proj-a", "auth", "idea", "auth idea");
    createContent(db, "proj-a", "auth", "spec", "auth spec");
    createContent(db, "proj-a", "search", "plan", "search plan");
    createContent(db, "proj-b", "auth", "idea", "other project idea");
  });

  it("returns all contents for a workspace", () => {
    const results = listContents(db, "proj-a");
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.workspace === "proj-a")).toBe(true);
  });

  it("does not return contents from other workspaces", () => {
    const results = listContents(db, "proj-a");
    expect(results.some((r) => r.workspace === "proj-b")).toBe(false);
  });

  it("filters by feature", () => {
    const results = listContents(db, "proj-a", "auth");
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.feature === "auth")).toBe(true);
  });

  it("filters by type", () => {
    const results = listContents(db, "proj-a", undefined, "idea");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("idea");
  });

  it("filters by both feature and type", () => {
    const results = listContents(db, "proj-a", "auth", "spec");
    expect(results).toHaveLength(1);
    expect(results[0].body).toBe("auth spec");
  });

  it("returns empty array when no documents match", () => {
    expect(listContents(db, "nonexistent")).toEqual([]);
  });

  it("throws when workspace is empty", () => {
    expect(() => listContents(db, "")).toThrow(/workspace must not be empty/);
  });

  it("includes title field on every row", () => {
    const results = listContents(db, "proj-a");
    expect(results.every((r) => "title" in r)).toBe(true);
  });

  it("includes doc type in default listing", () => {
    createContent(db, "proj-a", "auth", "doc", "some doc body", "Auth Doc");
    const results = listContents(db, "proj-a");
    expect(results.some((r) => r.type === "doc")).toBe(true);
  });

  it("returns title value when set", () => {
    createContent(db, "proj-a", "auth", "doc", "doc body", "Titled Doc");
    const results = listContents(db, "proj-a", "auth", "doc");
    expect(results[0].title).toBe("Titled Doc");
  });

  it("filters by custom type string", () => {
    createContent(db, "proj-a", "auth", "issue" as any, "a bug report");
    const results = listContents(db, "proj-a", undefined, "issue" as any);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("issue");
  });
});
