import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { linkContent } from "../../src/tools/link-content.js";
import { getLineage } from "../../src/tools/get-lineage.js";

function seed(db: Database.Database, workspace = "ws", feature = "ft"): number {
  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(workspace);
  const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(workspace) as { id: number };
  db.prepare("INSERT OR IGNORE INTO features (workspace_id, name) VALUES (?, ?)").run(ws.id, feature);
  const ft = db.prepare("SELECT id FROM features WHERE workspace_id = ? AND name = ?").get(ws.id, feature) as { id: number };
  return ft.id;
}

function insert(db: Database.Database, featureId: number, type: string, body: string): number {
  const { lastInsertRowid } = db.prepare("INSERT INTO contents (feature_id, type, body) VALUES (?, ?, ?)").run(featureId, type, body);
  return Number(lastInsertRowid);
}

describe("getLineage", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("throws Content not found for missing content", () => {
    expect(() => getLineage(db, 99999)).toThrow(/Content not found: id=99999/);
  });

  it("orphan content returns empty ancestors and descendants", () => {
    const ftId = seed(db);
    const id = insert(db, ftId, "idea", "lone idea");

    const result = getLineage(db, id);

    expect(result.root.id).toBe(id);
    expect(result.ancestors).toHaveLength(0);
    expect(result.descendants).toHaveLength(0);
  });

  it("returns direct parent as ancestor", () => {
    const ftId = seed(db);
    const ideaId = insert(db, ftId, "idea", "idea");
    const specId = insert(db, ftId, "spec", "spec");
    linkContent(db, specId, ideaId);

    const result = getLineage(db, specId);

    expect(result.ancestors).toHaveLength(1);
    expect(result.ancestors[0].id).toBe(ideaId);
    expect(result.ancestors[0].type).toBe("idea");
    expect(result.descendants).toHaveLength(0);
  });

  it("returns full three-level chain", () => {
    const ftId = seed(db);
    const ideaId = insert(db, ftId, "idea", "idea");
    const specId = insert(db, ftId, "spec", "spec");
    const planId = insert(db, ftId, "plan", "plan");
    linkContent(db, specId, ideaId);
    linkContent(db, planId, specId);

    const result = getLineage(db, specId);

    expect(result.root.id).toBe(specId);
    expect(result.ancestors).toHaveLength(1);
    expect(result.ancestors[0].id).toBe(ideaId);
    expect(result.descendants).toHaveLength(1);
    expect(result.descendants[0].id).toBe(planId);
  });

  it("ancestors are ordered nearest → oldest", () => {
    const ftId = seed(db);
    const ideaId = insert(db, ftId, "idea", "idea");
    const specId = insert(db, ftId, "spec", "spec");
    const planId = insert(db, ftId, "plan", "plan");
    linkContent(db, specId, ideaId);
    linkContent(db, planId, specId);

    const result = getLineage(db, planId);

    expect(result.ancestors[0].id).toBe(specId);   // nearest first
    expect(result.ancestors[1].id).toBe(ideaId);   // oldest last
  });

  it("branching descendants: one idea → two specs", () => {
    const ftId = seed(db);
    const ideaId = insert(db, ftId, "idea", "idea");
    const spec1 = insert(db, ftId, "spec", "spec 1");
    const spec2 = insert(db, ftId, "spec", "spec 2");
    linkContent(db, spec1, ideaId);
    linkContent(db, spec2, ideaId);

    const result = getLineage(db, ideaId);

    expect(result.descendants).toHaveLength(2);
    const ids = result.descendants.map((d) => d.id);
    expect(ids).toContain(spec1);
    expect(ids).toContain(spec2);
  });

  it("returns LinkedContent shape (no body field)", () => {
    const ftId = seed(db);
    const ideaId = insert(db, ftId, "idea", "idea body");

    const result = getLineage(db, ideaId);

    expect("body" in result.root).toBe(false);
    expect(result.root.id).toBeTruthy();
    expect(result.root.workspace).toBe("ws");
    expect(result.root.feature).toBe("ft");
    expect(result.root.type).toBe("idea");
  });

  it("get_lineage from root returns all descendants in BFS order", () => {
    const ftId = seed(db);
    const ideaId = insert(db, ftId, "idea", "idea");
    const spec1 = insert(db, ftId, "spec", "spec 1");
    const spec2 = insert(db, ftId, "spec", "spec 2");
    const plan1 = insert(db, ftId, "plan", "plan 1");
    linkContent(db, spec1, ideaId);
    linkContent(db, spec2, ideaId);
    linkContent(db, plan1, spec1);

    const result = getLineage(db, ideaId);

    // BFS: spec1, spec2 (level 1) before plan1 (level 2)
    const ids = result.descendants.map((d) => d.id);
    expect(ids.indexOf(spec1)).toBeLessThan(ids.indexOf(plan1));
    expect(ids.indexOf(spec2)).toBeLessThan(ids.indexOf(plan1));
  });
});
