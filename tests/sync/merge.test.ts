import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { mergeWorkspace } from "../../src/sync/merge.js";

let db: Database.Database;

function seed(workspaceName: string, featureNames: string[]): void {
  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(workspaceName);
  const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(workspaceName) as { id: number };
  for (const name of featureNames) {
    db.prepare("INSERT OR IGNORE INTO features (workspace_id, name) VALUES (?, ?)").run(ws.id, name);
  }
}

function featureNamesIn(workspaceName: string): string[] {
  const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(workspaceName) as { id: number } | undefined;
  if (!ws) return [];
  return (db.prepare("SELECT name FROM features WHERE workspace_id = ? ORDER BY name").all(ws.id) as { name: string }[])
    .map((r) => r.name);
}

beforeEach(() => {
  db = createTestDb();
});

describe("mergeWorkspace", () => {
  it("moves all features from src to dst", () => {
    seed("bar", ["auth", "search"]);
    seed("foo", ["billing"]);

    const result = mergeWorkspace(db, "bar", "foo");

    expect(result.featuresMoved).toBe(2);
    expect(result.featuresRenamed).toEqual([]);
    expect(featureNamesIn("foo")).toContain("auth");
    expect(featureNamesIn("foo")).toContain("search");
    expect(featureNamesIn("foo")).toContain("billing");
    expect(featureNamesIn("bar")).toEqual([]);
  });

  it("renames colliding feature with [src] suffix", () => {
    seed("bar", ["auth"]);
    seed("foo", ["auth"]);

    const result = mergeWorkspace(db, "bar", "foo");

    expect(result.featuresRenamed).toEqual(["auth"]);
    expect(featureNamesIn("foo")).toContain("auth");
    expect(featureNamesIn("foo")).toContain("auth [bar]");
    expect(featureNamesIn("bar")).toEqual([]);
  });

  it("renames multiple collisions correctly", () => {
    seed("bar", ["auth", "search", "billing"]);
    seed("foo", ["auth", "billing"]);

    const result = mergeWorkspace(db, "bar", "foo");

    expect(result.featuresRenamed.sort()).toEqual(["auth", "billing"]);
    expect(result.featuresMoved).toBe(3);
    expect(featureNamesIn("foo").sort()).toEqual(["auth", "auth [bar]", "billing", "billing [bar]", "search"]);
  });

  it("is idempotent — merge on empty src returns 0 features moved", () => {
    seed("bar", []);
    seed("foo", ["auth"]);

    const result = mergeWorkspace(db, "bar", "foo");

    expect(result.featuresMoved).toBe(0);
    expect(result.featuresRenamed).toEqual([]);
    expect(featureNamesIn("foo")).toEqual(["auth"]);
  });

  it("src workspace row still exists after merge with 0 features", () => {
    seed("bar", ["auth"]);
    seed("foo", []);

    mergeWorkspace(db, "bar", "foo");

    const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get("bar");
    expect(ws).toBeDefined();
    expect(featureNamesIn("bar")).toEqual([]);
  });

  it("throws when src workspace not found", () => {
    seed("foo", []);
    expect(() => mergeWorkspace(db, "nonexistent", "foo")).toThrow(/nonexistent/);
  });

  it("throws when dst workspace not found", () => {
    seed("bar", []);
    expect(() => mergeWorkspace(db, "bar", "nonexistent")).toThrow(/nonexistent/);
  });

  it("throws when src and dst are the same workspace", () => {
    seed("foo", ["auth"]);
    expect(() => mergeWorkspace(db, "foo", "foo")).toThrow(/same workspace/);
  });
});
