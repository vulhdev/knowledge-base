import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { utimesSync } from "node:fs";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { makeRepo, type Repo } from "./git-fixture.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(true),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
}));
vi.mock("../../src/tools/conflict-detection.js", () => ({ detectConflicts: vi.fn() }));

import { scanSources } from "../../src/import/scan.js";
import { buildLoadPlan } from "../../src/import/plan.js";
import { applyPlanToDb } from "../../src/import/apply-docs.js";
import { detectConflicts } from "../../src/tools/conflict-detection.js";

let repo: Repo;
let db: Database.Database;
const C1 = ".claude/claude/docs/p";
const C2 = "clone2/.claude/claude/docs/p";
const dirs = () => [join(repo.dir, C1), join(repo.dir, C2), join(repo.dir, "sot")];
const run = () => applyPlanToDb(db, buildLoadPlan(scanSources(dirs()), "ws", "ws-sot"));

beforeEach(() => {
  repo = makeRepo();
  repo.write(".gitignore", ".claude/claude\nclone2\n");
  repo.write("sot/F-001-x.md", "# F-001\n" + "見積の本文である。".repeat(10) + "\n");
  repo.commit("sot");
  repo.write(`${C1}/a.md`, "# A\nshared\nonly-one\n");
  repo.write(`${C2}/a.md`, "# A\nshared\nonly-two\n");
  utimesSync(join(repo.dir, C2, "a.md"), new Date(2020, 0, 1), new Date(2020, 0, 1));
  repo.write(`${C1}/same.md`, "# Same\nbody\n");
  repo.write(`${C2}/same.md`, "# Same\nbody\n");
  repo.write(`${C1}/n.md`, "# N\n");
  repo.write(`${C2}/n-20260101.md`, "# N dated\n");
  db = createTestDb();
});
afterEach(() => repo.cleanup());

describe("applyPlanToDb", () => {
  it("creates canonical docs, a fork residue linked under its canonical, a series link and the card", async () => {
    const r = await run();
    expect(r.errors).toEqual([]);
    expect(r).toMatchObject({ doc_count: 4, residue_count: 1, card_count: 1, missing_embeddings: 0, exit_code: 0 });
    expect(r.docs).toMatchObject({ created: 5, residues: 1, links: 2 });
    const residue = db.prepare("SELECT id, body, title FROM contents WHERE type = 'fork-residue'").get() as { id: number; body: string; title: string };
    expect(residue.body).toBe("only-two\n");
    expect(residue.title).toBe("A (fork residue: clone2)");
    const canonical = (db.prepare("SELECT id, body FROM contents WHERE source_key = 'doc:ws:docs/p/a.md'").get() as { id: number; body: string });
    expect(canonical.body).toContain("only-one");
    expect(db.prepare("SELECT 1 FROM content_links WHERE parent_id = ? AND child_id = ?").get(canonical.id, residue.id)).toBeTruthy();
    expect(detectConflicts).not.toHaveBeenCalled();
  });

  it("writes nothing on a second run", async () => {
    await run();
    const r2 = await run();
    expect(r2.writes).toBe(0);
    expect(r2.docs).toMatchObject({ created: 0, updated: 0, unchanged: 5, links: 0 });
    expect(r2.cards).toMatchObject({ created: 0, updated: 0, unchanged: 1, deleted: 0 });
  });

  it("updates a changed doc in place, keeping its id", async () => {
    await run();
    const before = db.prepare("SELECT id FROM contents WHERE source_key = 'doc:ws:docs/p/n.md'").get() as { id: number };
    repo.write(`${C1}/n.md`, "# N\nchanged\n");
    const r = await run();
    expect(r.docs.updated).toBe(1);
    const after = db.prepare("SELECT id, body FROM contents WHERE source_key = 'doc:ws:docs/p/n.md'").get() as { id: number; body: string };
    expect(after.id).toBe(before.id);
    expect(after.body).toContain("changed");
  });

  it("resumes after an interrupted run without duplicates", async () => {
    const plan = buildLoadPlan(scanSources(dirs()), "ws", "ws-sot");
    const partial = { ...plan, items: plan.items.slice(0, 2), links: [] };
    await applyPlanToDb(db, partial);
    await applyPlanToDb(db, plan);
    const dupes = db.prepare("SELECT source_key, count(*) AS n FROM contents WHERE source_key IS NOT NULL GROUP BY source_key HAVING n > 1").all();
    expect(dupes).toEqual([]);
    expect((db.prepare("SELECT count(*) AS n FROM contents").get() as { n: number }).n).toBe(6);
  });
});

describe("SOT card identity across repositories and pruning safety", () => {
  let other: Repo;
  beforeEach(() => {
    other = makeRepo();
    other.write("sot/F-001-x.md", "# other repo\n" + "別リポジトリの本文。".repeat(10) + "\n");
    other.commit("other");
  });
  afterEach(() => other.cleanup());

  const sotOnly = (dirsList: string[]) => buildLoadPlan(scanSources(dirsList), "ws", "ws-sot");

  it("two repositories with the same path get different card keys and stable sha", async () => {
    const p = sotOnly([join(repo.dir, "sot"), join(other.dir, "sot")]);
    const keys = p.items.filter((i) => i.kind === "card").map((i) => i.source_key);
    expect(new Set(keys).size).toBe(2);
    await applyPlanToDb(db, p);
    const r2 = await applyPlanToDb(db, sotOnly([join(repo.dir, "sot"), join(other.dir, "sot")]));
    expect(r2.writes).toBe(0);
    expect(r2.cards.unchanged).toBe(2);
  });

  it("pruning a repository scanned at its root never deletes another repository's cards", async () => {
    await applyPlanToDb(db, sotOnly([join(repo.dir, "sot"), join(other.dir, "sot")]));
    other.git("rm", "-q", "-r", "sot");
    other.write("README.md", "# root file\n");
    other.commit("move");
    const r = await applyPlanToDb(db, sotOnly([other.dir]));
    expect(r.cards.deleted).toBe(1);
    expect((db.prepare("SELECT count(*) AS n FROM contents WHERE source_key LIKE 'sot:%' AND body LIKE '%' || ? || '%'").get(repo.dir.split("/").pop()) as { n: number }).n).toBe(1);
  });

  it("scanning the same repository twice yields one card per file and a warning", () => {
    const p = sotOnly([join(repo.dir, "sot"), join(repo.dir, "sot")]);
    expect(p.items.filter((i) => i.kind === "card")).toHaveLength(1);
    expect(p.warnings.some((w) => w.includes("duplicate SOT key"))).toBe(true);
  });

  it("a card that cannot be planned (e.g. now binary) keeps its existing card and pointers", async () => {
    await applyPlanToDb(db, sotOnly([join(repo.dir, "sot")]));
    const before = (db.prepare("SELECT count(*) AS n FROM content_chunks WHERE kind = 'sot'").get() as { n: number }).n;
    repo.write("sot/F-001-x.md", "binary\u0000data");
    repo.commit("binary");
    const p = sotOnly([join(repo.dir, "sot")]);
    expect(p.skipped_keys).toHaveLength(1);
    const r = await applyPlanToDb(db, p);
    expect(r.cards.deleted).toBe(0);
    expect((db.prepare("SELECT count(*) AS n FROM content_chunks WHERE kind = 'sot'").get() as { n: number }).n).toBe(before);
  });
});
