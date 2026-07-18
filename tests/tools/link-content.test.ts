import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { linkContent } from "../../src/tools/link-content.js";

function seed(db: Database.Database, workspace: string, feature: string) {
  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(workspace);
  const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(workspace) as { id: number };
  db.prepare("INSERT OR IGNORE INTO features (workspace_id, name) VALUES (?, ?)").run(ws.id, feature);
  const ft = db.prepare("SELECT id FROM features WHERE workspace_id = ? AND name = ?").get(ws.id, feature) as { id: number };
  return ft.id;
}

function insertContent(db: Database.Database, featureId: number, type: string, body: string): number {
  const { lastInsertRowid } = db.prepare("INSERT INTO contents (feature_id, type, body) VALUES (?, ?, ?)").run(featureId, type, body);
  return Number(lastInsertRowid);
}

describe("linkContent", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("creates a link and returns LinkResult", () => {
    const ftId = seed(db, "ws", "ft");
    const parentId = insertContent(db, ftId, "idea", "an idea");
    const childId = insertContent(db, ftId, "spec", "a spec");

    const result = linkContent(db, childId, parentId);

    expect(result.parent_id).toBe(parentId);
    expect(result.child_id).toBe(childId);
    expect(result.created_at).toBeTruthy();
    expect(result.direction_warning).toBeUndefined();
  });

  it("link is persisted in content_links table", () => {
    const ftId = seed(db, "ws", "ft");
    const parentId = insertContent(db, ftId, "idea", "idea");
    const childId = insertContent(db, ftId, "spec", "spec");

    linkContent(db, childId, parentId);

    const row = db.prepare("SELECT * FROM content_links WHERE parent_id = ? AND child_id = ?").get(parentId, childId);
    expect(row).toBeTruthy();
  });

  it("is idempotent — calling twice with same IDs does not create duplicate", () => {
    const ftId = seed(db, "ws", "ft");
    const parentId = insertContent(db, ftId, "idea", "idea");
    const childId = insertContent(db, ftId, "spec", "spec");

    linkContent(db, childId, parentId);
    linkContent(db, childId, parentId);

    const { n } = db.prepare("SELECT COUNT(*) AS n FROM content_links").get() as { n: number };
    expect(n).toBe(1);
  });

  it("throws Content not found when parent ID is missing", () => {
    const ftId = seed(db, "ws", "ft");
    const childId = insertContent(db, ftId, "spec", "spec");

    expect(() => linkContent(db, childId, 99999)).toThrow(/Content not found: id=99999/);
  });

  it("throws Content not found when child ID is missing", () => {
    const ftId = seed(db, "ws", "ft");
    const parentId = insertContent(db, ftId, "idea", "idea");

    expect(() => linkContent(db, 99999, parentId)).toThrow(/Content not found: id=99999/);
  });

  it("emits direction_warning when linking plan (parent) → idea (child) — reverse order", () => {
    const ftId = seed(db, "ws", "ft");
    const planId = insertContent(db, ftId, "plan", "a plan");
    const ideaId = insertContent(db, ftId, "idea", "an idea");

    // child=idea, parent=plan → plan→idea is reverse order
    const result = linkContent(db, ideaId, planId);

    expect(result.direction_warning).toBeTruthy();
    expect(result.direction_warning).toMatch(/plan.*idea|direction/i);
  });

  it("emits direction_warning when linking spec → spec (same type)", () => {
    const ftId = seed(db, "ws", "ft");
    const spec1 = insertContent(db, ftId, "spec", "spec 1");
    const spec2 = insertContent(db, ftId, "spec", "spec 2");

    const result = linkContent(db, spec2, spec1);

    expect(result.direction_warning).toBeTruthy();
  });

  it("does NOT emit direction_warning for unknown/custom types", () => {
    const ftId = seed(db, "ws", "ft");
    const adrId = insertContent(db, ftId, "adr", "an adr");
    const ideaId = insertContent(db, ftId, "idea", "an idea");

    const result = linkContent(db, adrId, ideaId);

    expect(result.direction_warning).toBeUndefined();
  });

  it("succeeds with direction_warning when parent and child are in different workspaces", () => {
    const ftId1 = seed(db, "ws1", "ft");
    const ftId2 = seed(db, "ws2", "ft");
    const parentId = insertContent(db, ftId1, "idea", "idea in ws1");
    const childId = insertContent(db, ftId2, "plan", "plan in ws2");

    const result = linkContent(db, childId, parentId);

    expect(result.parent_id).toBe(parentId);
    expect(result.direction_warning).toBeTruthy();
  });

  it("one parent can have multiple children", () => {
    const ftId = seed(db, "ws", "ft");
    const parentId = insertContent(db, ftId, "idea", "idea");
    const child1 = insertContent(db, ftId, "spec", "spec 1");
    const child2 = insertContent(db, ftId, "spec", "spec 2");

    linkContent(db, child1, parentId);
    linkContent(db, child2, parentId);

    const { n } = db.prepare("SELECT COUNT(*) AS n FROM content_links WHERE parent_id = ?").get(parentId) as { n: number };
    expect(n).toBe(2);
  });
});
