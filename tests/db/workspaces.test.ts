import { describe, it, expect, beforeEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createTestDb } from "../setup.js";
import { listWorkspaces, createWorkspace } from "../../src/db/workspaces.js";

describe("listWorkspaces", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns empty array on empty DB", () => {
    expect(listWorkspaces(db)).toEqual([]);
  });

  it("returns all workspaces sorted alphabetically", () => {
    db.prepare("INSERT INTO workspaces (name) VALUES (?)").run("zebra");
    db.prepare("INSERT INTO workspaces (name) VALUES (?)").run("alpha");
    db.prepare("INSERT INTO workspaces (name) VALUES (?)").run("mango");

    const result = listWorkspaces(db);
    expect(result.map((w) => w.name)).toEqual(["alpha", "mango", "zebra"]);
  });

  it("returns id and name for each workspace", () => {
    db.prepare("INSERT INTO workspaces (name) VALUES (?)").run("my-project");

    const result = listWorkspaces(db);
    expect(result[0]).toMatchObject({ name: "my-project" });
    expect(typeof result[0].id).toBe("number");
  });
});

describe("createWorkspace", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  it("inserts a new workspace and returns it", () => {
    const ws = createWorkspace(db, "my-project");
    expect(ws).toMatchObject({ name: "my-project" });
    expect(typeof ws.id).toBe("number");
  });

  it("does not throw when called twice with the same name", () => {
    const first = createWorkspace(db, "duplicate");
    const second = createWorkspace(db, "duplicate");
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("duplicate");
  });

  it("created workspace appears in listWorkspaces", () => {
    createWorkspace(db, "new-ws");
    const list = listWorkspaces(db);
    expect(list.map((w) => w.name)).toContain("new-ws");
  });
});
