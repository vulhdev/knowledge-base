import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { listContents } from "../../src/tools/list-contents.js";
import { fetchFeatures } from "../../src/tools/_helpers.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("listContents", () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = createTestDb();
    await createContent(db, "proj-a", ["auth"], "idea", "auth idea");
    await createContent(db, "proj-a", ["auth"], "spec", "auth spec");
    await createContent(db, "proj-a", ["search"], "plan", "search plan");
    await createContent(db, "proj-b", ["auth"], "idea", "other project idea");
  });

  it("returns all contents for a workspace", () => {
    const { results } = listContents(db, "proj-a");
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.workspace === "proj-a")).toBe(true);
  });

  it("does not return contents from other workspaces", () => {
    const { results } = listContents(db, "proj-a");
    expect(results.some((r) => r.workspace === "proj-b")).toBe(false);
  });

  it("filters by feature", () => {
    const { results } = listContents(db, "proj-a", "auth");
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.features.includes("auth"))).toBe(true);
  });

  it("filters by type", () => {
    const { results } = listContents(db, "proj-a", undefined, "idea");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("idea");
  });

  it("filters by both feature and type", () => {
    const { results } = listContents(db, "proj-a", "auth", "spec");
    expect(results).toHaveLength(1);
    expect(results[0].body).toBe("auth spec");
  });

  it("returns empty results when no documents match", () => {
    const page = listContents(db, "nonexistent");
    expect(page.results).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.has_more).toBe(false);
  });

  it("throws when workspace is empty", () => {
    expect(() => listContents(db, "")).toThrow(/workspace must not be empty/);
  });

  it("includes title field on every row", () => {
    const { results } = listContents(db, "proj-a");
    expect(results.every((r) => "title" in r)).toBe(true);
  });

  it("includes doc type in default listing", async () => {
    await createContent(db, "proj-a", ["auth"], "doc", "some doc body", "Auth Doc");
    const { results } = listContents(db, "proj-a");
    expect(results.some((r) => r.type === "doc")).toBe(true);
  });

  it("returns title value when set", async () => {
    await createContent(db, "proj-a", ["auth"], "doc", "doc body", "Titled Doc");
    const { results } = listContents(db, "proj-a", "auth", "doc");
    expect(results[0].title).toBe("Titled Doc");
  });

  it("filters by custom type string", async () => {
    await createContent(db, "proj-a", ["auth"], "issue" as any, "a bug report");
    const { results } = listContents(db, "proj-a", undefined, "issue" as any);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("issue");
  });

  // pagination
  it("returns correct slice and has_more=true when more results exist", () => {
    const page = listContents(db, "proj-a", undefined, undefined, 2, 0);
    expect(page.results).toHaveLength(2);
    expect(page.has_more).toBe(true);
    expect(page.total).toBe(3);
    expect(page.offset).toBe(0);
    expect(page.limit).toBe(2);
  });

  it("returns last page with has_more=false", () => {
    const page = listContents(db, "proj-a", undefined, undefined, 2, 2);
    expect(page.results).toHaveLength(1);
    expect(page.has_more).toBe(false);
    expect(page.total).toBe(3);
  });

  it("returns empty results when offset exceeds total", () => {
    const page = listContents(db, "proj-a", undefined, undefined, 10, 100);
    expect(page.results).toEqual([]);
    expect(page.has_more).toBe(false);
    expect(page.total).toBe(3);
  });

  it("clamps limit=0 to 1", () => {
    const page = listContents(db, "proj-a", undefined, undefined, 0, 0);
    expect(page.limit).toBe(1);
    expect(page.results.length).toBeLessThanOrEqual(1);
  });

  it("clamps limit above MAX_LIMIT to 200", () => {
    const page = listContents(db, "proj-a", undefined, undefined, 9999, 0);
    expect(page.limit).toBe(200);
  });

  it("clamps negative offset to 0", () => {
    const page = listContents(db, "proj-a", undefined, undefined, 10, -5);
    expect(page.offset).toBe(0);
    expect(page.results).toHaveLength(3);
  });

  it("total reflects full count regardless of limit/offset", () => {
    const page = listContents(db, "proj-a", undefined, undefined, 1, 0);
    expect(page.total).toBe(3);
  });
});

describe("listContents batched feature lookup", () => {
  const SEEDED = 210;
  let db: Database.Database;
  let multiWorkspaceId: number;

  beforeEach(() => {
    db = createTestDb();
    const insertWorkspace = db.prepare("INSERT INTO workspaces (name) VALUES (?)");
    const wsA = Number(insertWorkspace.run("bulk-a").lastInsertRowid);
    const wsB = Number(insertWorkspace.run("bulk-b").lastInsertRowid);
    const insertFeature = db.prepare("INSERT INTO features (workspace_id, name) VALUES (?, ?)");
    const fMain = Number(insertFeature.run(wsA, "main").lastInsertRowid);
    const fExtra = Number(insertFeature.run(wsA, "extra").lastInsertRowid);
    const fForeign = Number(insertFeature.run(wsB, "foreign").lastInsertRowid);

    const insertContent = db.prepare("INSERT INTO contents (type, title, body) VALUES (?, ?, ?)");
    const link = db.prepare("INSERT INTO content_features (content_id, feature_id) VALUES (?, ?)");
    db.transaction(() => {
      for (let i = 0; i < SEEDED; i++) {
        const id = Number(insertContent.run(i % 2 === 0 ? "idea" : "spec", `doc ${i}`, `body ${i}`).lastInsertRowid);
        link.run(id, fMain);
        if (i % 3 === 0) link.run(id, fExtra);
        if (i === SEEDED - 3) {
          link.run(id, fForeign);
          multiWorkspaceId = id;
        }
      }
    })();
  });

  function countPrepares(run: () => void): number {
    const spy = vi.spyOn(db, "prepare");
    spy.mockClear();
    run();
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    return calls;
  }

  it("prepares the same small number of statements regardless of limit", () => {
    const counts = [1, 50, 200].map((limit) =>
      countPrepares(() => {
        const page = listContents(db, "bulk-a", undefined, undefined, limit, 0);
        expect(page.results).toHaveLength(limit);
      }),
    );
    expect(counts[0]).toBe(counts[1]);
    expect(counts[1]).toBe(counts[2]);
    expect(counts[0]).toBeLessThanOrEqual(3);
  });

  it("attaches the same features as fetchFeatures for every row", () => {
    const { results } = listContents(db, "bulk-a", undefined, undefined, 200, 0);
    expect(results).toHaveLength(200);
    for (const row of results) {
      expect(row.features).toEqual(fetchFeatures(db, row.id));
    }
  });

  it("includes feature names from other workspaces for a multi-workspace document", () => {
    const { results } = listContents(db, "bulk-a", undefined, undefined, 200, 0);
    const row = results.find((r) => r.id === multiWorkspaceId);
    expect(row).toBeDefined();
    expect(row!.features).toEqual(["extra", "foreign", "main"]);
  });

  it("prepares only count and data statements for an empty page", () => {
    let page: ReturnType<typeof listContents> | undefined;
    const calls = countPrepares(() => {
      page = listContents(db, "bulk-a", undefined, undefined, 50, SEEDED + 10);
    });
    expect(page!.results).toEqual([]);
    expect(page!.total).toBe(SEEDED);
    expect(calls).toBe(2);
  });
});

describe("listContents ordering and query plan", () => {
  let db: Database.Database;
  let featureId: number;

  beforeEach(() => {
    db = createTestDb();
    const wsId = Number(db.prepare("INSERT INTO workspaces (name) VALUES (?)").run("order-ws").lastInsertRowid);
    featureId = Number(db.prepare("INSERT INTO features (workspace_id, name) VALUES (?, ?)").run(wsId, "ft").lastInsertRowid);
  });

  function seed(rows: { type: string; created_at: string }[]): { id: number; created_at: string }[] {
    const insert = db.prepare("INSERT INTO contents (type, body, created_at, updated_at) VALUES (?, ?, ?, ?)");
    const link = db.prepare("INSERT INTO content_features (content_id, feature_id) VALUES (?, ?)");
    return rows.map((r, i) => {
      const id = Number(insert.run(r.type, `body ${i}`, r.created_at, r.created_at).lastInsertRowid);
      link.run(id, featureId);
      return { id, created_at: r.created_at };
    });
  }

  function pageThrough(feature?: string): number[] {
    const ids: number[] = [];
    for (let offset = 0; ; offset++) {
      const page = listContents(db, "order-ws", feature, undefined, 1, offset);
      if (page.results.length === 0) break;
      ids.push(page.results[0].id);
    }
    return ids;
  }

  it("orders documents sharing created_at by id descending, without and with a feature filter", () => {
    const seeded = seed(Array.from({ length: 4 }, () => ({ type: "idea", created_at: "2026-01-01 00:00:00" })));
    const expected = seeded.map((r) => r.id).sort((a, b) => b - a);

    for (const feature of [undefined, "ft"]) {
      const ids = pageThrough(feature);
      expect(ids).toEqual(expected);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("default listing follows created_at DESC, id DESC", () => {
    const seeded = seed([
      { type: "idea", created_at: "2026-01-02 00:00:00" },
      { type: "spec", created_at: "2026-01-05 00:00:00" },
      { type: "plan", created_at: "2026-01-03 00:00:00" },
      { type: "idea", created_at: "2026-01-05 00:00:00" },
      { type: "doc", created_at: "2026-01-01 00:00:00" },
    ]);
    const expected = [...seeded]
      .sort((a, b) => (a.created_at === b.created_at ? b.id - a.id : a.created_at < b.created_at ? 1 : -1))
      .map((r) => r.id);

    const { results } = listContents(db, "order-ws");
    expect(results.map((r) => r.id)).toEqual(expected);
  });

  // Captures the data statement listContents actually runs (SQL + bound args) and explains it.
  function dataQueryPlan(type?: string): string[] {
    const originalPrepare = db.prepare.bind(db);
    const captured: { sql: string; args: unknown[] }[] = [];
    const spy = vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.includes("LIMIT ? OFFSET ?")) {
        const all = stmt.all.bind(stmt);
        (stmt as unknown as { all: (...a: unknown[]) => unknown[] }).all = (...args: unknown[]) => {
          captured.push({ sql, args });
          return all(...(args as never[]));
        };
      }
      return stmt;
    }) as typeof db.prepare);
    listContents(db, "order-ws", undefined, type, 10, 0);
    spy.mockRestore();

    expect(captured).toHaveLength(1);
    const { sql, args } = captured[0];
    return (db.prepare("EXPLAIN QUERY PLAN " + sql).all(...(args as never[])) as { detail: string }[]).map((r) => r.detail);
  }

  it("default and type-filtered data queries use the created_at indexes without a temp sort", () => {
    seed(Array.from({ length: 20 }, (_, i) => ({
      type: i % 2 === 0 ? "idea" : "spec",
      created_at: `2026-01-${String(i + 1).padStart(2, "0")} 00:00:00`,
    })));

    const defaultPlan = dataQueryPlan();
    expect(defaultPlan.some((d) => d.includes("TEMP B-TREE"))).toBe(false);
    expect(defaultPlan.some((d) => d.includes("idx_contents_created_at"))).toBe(true);

    const typePlan = dataQueryPlan("idea");
    expect(typePlan.some((d) => d.includes("TEMP B-TREE"))).toBe(false);
    expect(typePlan.some((d) => d.includes("idx_contents_type_created_at"))).toBe(true);
  });
});
