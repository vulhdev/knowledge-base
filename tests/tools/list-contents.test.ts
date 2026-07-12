import { describe, it, expect, beforeEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { listContents } from "../../src/tools/list-contents.js";

describe("listContents", () => {
  let db: DatabaseSync;

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
});
