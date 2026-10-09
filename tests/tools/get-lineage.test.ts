import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { linkContent } from "../../src/tools/link-content.js";
import { getLineage } from "../../src/tools/get-lineage.js";
import { fetchFeatures } from "../../src/tools/_helpers.js";

function seed(db: Database.Database, workspace = "ws", feature = "ft"): number {
  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(workspace);
  const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(workspace) as { id: number };
  db.prepare("INSERT OR IGNORE INTO features (workspace_id, name) VALUES (?, ?)").run(ws.id, feature);
  const ft = db.prepare("SELECT id FROM features WHERE workspace_id = ? AND name = ?").get(ws.id, feature) as { id: number };
  return ft.id;
}

function insert(db: Database.Database, featureId: number, type: string, body: string): number {
  const { lastInsertRowid } = db.prepare("INSERT INTO contents (type, body) VALUES (?, ?)").run(type, body);
  const id = Number(lastInsertRowid);
  db.prepare("INSERT INTO content_features (content_id, feature_id) VALUES (?, ?)").run(id, featureId);
  return id;
}

// Content with no content_features row — linkContent refuses it, so edges touching it go in raw.
function insertFeatureless(db: Database.Database, type: string, body: string): number {
  const { lastInsertRowid } = db.prepare("INSERT INTO contents (type, body) VALUES (?, ?)").run(type, body);
  return Number(lastInsertRowid);
}

function insertLink(db: Database.Database, parentId: number, childId: number): void {
  db.prepare("INSERT INTO content_links (parent_id, child_id) VALUES (?, ?)").run(parentId, childId);
}

function countPrepares(db: Database.Database, run: () => void): number {
  const spy = vi.spyOn(db, "prepare");
  spy.mockClear();
  run();
  const calls = spy.mock.calls.length;
  spy.mockRestore();
  return calls;
}

const idsOf = (nodes: { id: number }[]): number[] => nodes.map((n) => n.id);

// Counts db.prepare calls and executions (.all/.get/.iterate) of every statement it returns.
// The wrapper stays on a statement after restore(), so a statement prepared (and cached) while
// instrumented keeps counting executions on later calls.
function instrumentStatements(db: Database.Database) {
  const counts = { prepares: 0, executions: 0 };
  const prepare = db.prepare.bind(db);
  const spy = vi.spyOn(db, "prepare").mockImplementation((source: string) => {
    counts.prepares++;
    const stmt = prepare(source);
    for (const method of ["all", "get", "iterate"] as const) {
      const original = stmt[method].bind(stmt) as (...args: unknown[]) => unknown;
      vi.spyOn(stmt, method).mockImplementation(((...args: unknown[]) => {
        counts.executions++;
        return original(...args);
      }) as never);
    }
    return stmt;
  });
  return {
    take(): { prepares: number; executions: number } {
      const snapshot = { ...counts };
      counts.prepares = 0;
      counts.executions = 0;
      return snapshot;
    },
    restore: () => spy.mockRestore(),
  };
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
    expect(result.root.features).toContain("ft");
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

describe("getLineage — characterization of current behaviour", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  function fourNodes(target: Database.Database): number[] {
    const ftId = seed(target);
    return [1, 2, 3, 4].map((n) => insert(target, ftId, "doc", `node ${n}`));
  }

  it("multi-parent: ancestors follow the earliest-inserted parent link (2→4 first)", () => {
    const [n1, n2, n3, n4] = fourNodes(db);
    linkContent(db, n2, n1);
    linkContent(db, n4, n2);
    linkContent(db, n4, n3);

    expect(idsOf(getLineage(db, n4).ancestors)).toEqual([n2, n1]);
  });

  it("multi-parent: ancestors follow the earliest-inserted parent link (3→4 first)", () => {
    const other = createTestDb();
    const [n1, n2, n3, n4] = fourNodes(other);
    linkContent(other, n2, n1);
    linkContent(other, n4, n3);
    linkContent(other, n4, n2);

    expect(idsOf(getLineage(other, n4).ancestors)).toEqual([n3]);
  });

  it("children come back in ascending child id, not link insertion order", () => {
    const ftId = seed(db);
    const parent = insert(db, ftId, "idea", "parent");
    insert(db, ftId, "doc", "unlinked");
    const c3 = insert(db, ftId, "spec", "c3");
    const c4 = insert(db, ftId, "spec", "c4");
    const c5 = insert(db, ftId, "spec", "c5");
    linkContent(db, c5, parent);
    linkContent(db, c3, parent);
    linkContent(db, c4, parent);

    expect(idsOf(getLineage(db, parent).descendants)).toEqual([c3, c4, c5]);
  });

  it("two-node cycle terminates and reports the root among its own ancestors", () => {
    const ftId = seed(db);
    const n1 = insert(db, ftId, "doc", "n1");
    const n2 = insert(db, ftId, "doc", "n2");
    insertLink(db, n1, n2);
    insertLink(db, n2, n1);

    const result = getLineage(db, n1);
    expect(idsOf(result.ancestors)).toEqual([n2, n1]);
    expect(idsOf(result.descendants)).toEqual([n2]);
  });

  it("self-link: root is its own ancestor, never its own descendant", () => {
    const ftId = seed(db);
    const n1 = insert(db, ftId, "doc", "n1");
    insertLink(db, n1, n1);

    const result = getLineage(db, n1);
    expect(idsOf(result.ancestors)).toEqual([n1]);
    expect(result.descendants).toEqual([]);
  });

  it("diamond: shared descendant appears once; ancestors follow the first parent", () => {
    const [n1, n2, n3, n4] = fourNodes(db);
    linkContent(db, n2, n1);
    linkContent(db, n3, n1);
    linkContent(db, n4, n2);
    linkContent(db, n4, n3);

    expect(idsOf(getLineage(db, n1).descendants)).toEqual([n2, n3, n4]);
    expect(idsOf(getLineage(db, n4).ancestors)).toEqual([n2, n1]);
  });

  it("a featureless node in the middle of a chain stops the walk in both directions", () => {
    const ftId = seed(db);
    const n1 = insert(db, ftId, "idea", "n1");
    const n2 = insertFeatureless(db, "spec", "n2");
    const n3 = insert(db, ftId, "plan", "n3");
    insertLink(db, n1, n2);
    insertLink(db, n2, n3);

    expect(getLineage(db, n3).ancestors).toEqual([]);
    expect(getLineage(db, n1).descendants).toEqual([]);
  });

  it("throws Content not found for a root that exists but has no feature", () => {
    const id = insertFeatureless(db, "doc", "orphan");
    expect(() => getLineage(db, id)).toThrow(`Content not found: id=${id}`);
  });

  // Lowest feature id sits in "zeta" but carries the alphabetically last name.
  function multiWorkspaceNode(target: Database.Database): number {
    const fC = seed(target, "zeta", "c-feat");
    const fA = seed(target, "alpha", "a-feat");
    const fB = seed(target, "zeta", "b-feat");
    const id = insert(target, fA, "doc", "multi");
    target.prepare("INSERT INTO content_features (content_id, feature_id) VALUES (?, ?)").run(id, fB);
    target.prepare("INSERT INTO content_features (content_id, feature_id) VALUES (?, ?)").run(id, fC);
    return id;
  }

  it("multi-workspace: workspace comes from the lowest feature id, features sorted by name", () => {
    const multi = multiWorkspaceNode(db);
    const ftId = seed(db);
    const parent = insert(db, ftId, "idea", "parent");
    const child = insert(db, ftId, "plan", "child");
    linkContent(db, multi, parent);
    linkContent(db, child, multi);

    for (const node of [
      getLineage(db, multi).root,
      getLineage(db, parent).descendants[0],
      getLineage(db, child).ancestors[0],
    ]) {
      expect(node.id).toBe(multi);
      expect(node.workspace).toBe("zeta");
      expect(node.features).toEqual(["a-feat", "b-feat", "c-feat"]);
    }
  });

  function diamondWithMultiWorkspace(target: Database.Database): number[] {
    const [n1, n2, n3, n4] = fourNodes(target);
    const multi = multiWorkspaceNode(target);
    linkContent(target, n2, n1);
    linkContent(target, n3, n1);
    linkContent(target, n4, n2);
    linkContent(target, n4, n3);
    linkContent(target, n1, multi);
    return [n1, n2, n3, n4, multi];
  }

  it("every node carries the same features as fetchFeatures", () => {
    const [n1, , , n4] = diamondWithMultiWorkspace(db);
    for (const id of [n1, n4]) {
      const result = getLineage(db, id);
      for (const node of [result.root, ...result.ancestors, ...result.descendants]) {
        expect(node.features).toEqual(fetchFeatures(db, node.id));
      }
    }
  });

  it("every node keeps the key order id, workspace, type, title, features", () => {
    const [n1, , , n4] = diamondWithMultiWorkspace(db);
    for (const id of [n1, n4]) {
      const result = getLineage(db, id);
      for (const node of [result.root, ...result.ancestors, ...result.descendants]) {
        expect(Object.keys(node)).toEqual(["id", "workspace", "type", "title", "features"]);
      }
    }
  });
});

describe("getLineage — statement count", () => {
  // Each shape gets its own connection: statements are cached per connection,
  // so only the first (cold) call on a fresh db shows what a call costs.
  it("prepares the same small number of statements regardless of lineage size", () => {
    const lone = createTestDb();
    const loneId = insert(lone, seed(lone), "idea", "lone");

    const deep = createTestDb();
    const deepFt = seed(deep);
    const chain = Array.from({ length: 51 }, (_, i) => insert(deep, deepFt, "doc", `level ${i}`));
    for (let i = 1; i < chain.length; i++) insertLink(deep, chain[i - 1], chain[i]);
    const deepest = chain[chain.length - 1];

    const wide = createTestDb();
    const wideFt = seed(wide);
    const parent = insert(wide, wideFt, "idea", "parent");
    const children = Array.from({ length: 200 }, (_, i) => insert(wide, wideFt, "spec", `child ${i}`));
    for (const child of children) insertLink(wide, parent, child);

    const counts = [
      countPrepares(lone, () => {
        const result = getLineage(lone, loneId);
        expect(result.ancestors).toEqual([]);
        expect(result.descendants).toEqual([]);
      }),
      countPrepares(deep, () => {
        expect(idsOf(getLineage(deep, deepest).ancestors)).toEqual(chain.slice(0, -1).reverse());
      }),
      countPrepares(wide, () => {
        expect(idsOf(getLineage(wide, parent).descendants)).toEqual(children);
      }),
    ];

    expect(counts[0]).toBe(counts[1]);
    expect(counts[1]).toBe(counts[2]);
    expect(counts[0]).toBeLessThanOrEqual(4);

    const warm = countPrepares(deep, () => getLineage(deep, deepest));
    expect(warm).toBeLessThanOrEqual(counts[1]);
  });

  // Contract: exactly 1 prepare on the first call per connection, 0 afterwards, and the one
  // statement runs once per call — never once per node.
  it("prepares once per connection and executes exactly one statement per call", () => {
    const lone = createTestDb();
    const loneId = insert(lone, seed(lone), "idea", "lone");

    const deep = createTestDb();
    const deepFt = seed(deep);
    const chain = Array.from({ length: 51 }, (_, i) => insert(deep, deepFt, "doc", `level ${i}`));
    for (let i = 1; i < chain.length; i++) insertLink(deep, chain[i - 1], chain[i]);

    const wide = createTestDb();
    const wideFt = seed(wide);
    const parent = insert(wide, wideFt, "idea", "parent");
    const children = Array.from({ length: 200 }, (_, i) => insert(wide, wideFt, "spec", `child ${i}`));
    for (const child of children) insertLink(wide, parent, child);

    const shapes: [Database.Database, number, number][] = [
      [lone, loneId, 0],
      [deep, chain[chain.length - 1], 50],
      [wide, parent, 200],
    ];

    for (const [target, id, size] of shapes) {
      const probe = instrumentStatements(target);
      try {
        const cold = getLineage(target, id);
        expect(cold.ancestors.length + cold.descendants.length).toBe(size);
        expect(probe.take()).toEqual({ prepares: 1, executions: 1 });

        const warm = getLineage(target, id);
        expect(warm).toEqual(cold);
        expect(probe.take()).toEqual({ prepares: 0, executions: 1 });
      } finally {
        probe.restore();
      }
    }
  });
});
