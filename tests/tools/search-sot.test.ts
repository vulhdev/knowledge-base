import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { makeRepo, type Repo } from "../import/git-fixture.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(true),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
}));

import { scanSources } from "../../src/import/scan.js";
import { buildLoadPlan, type PlanCard } from "../../src/import/plan.js";
import { importSotCard } from "../../src/import/sot.js";
import { searchSemantic, runSotFtsSearch } from "../../src/tools/search-semantic.js";

const DOC = (topic: string, term: string) => [
  `# ${topic}`,
  "概要の説明である。".repeat(8),
  "## 詳細",
  `この節では${term}を扱う。${term}は重要な値である。`.repeat(4),
  "## 付録",
  "付録の本文である。".repeat(8),
].join("\n") + "\n";

let repo: Repo;
let db: Database.Database;
beforeEach(async () => {
  repo = makeRepo();
  repo.write("sot/F-001-a.md", DOC("見積", "掛率"));
  repo.write("sot/F-002-b.md", DOC("原価", "労災"));
  repo.write("sot/F-003-c.md", DOC("回次", "採番"));
  repo.commit("sot");
  db = createTestDb();
  const plan = buildLoadPlan(scanSources([join(repo.dir, "sot")]), "ws", "ws-sot");
  for (const c of plan.items as PlanCard[]) await importSotCard(db, c);
});
afterEach(() => repo.cleanup());

describe("search over SOT cards", () => {
  it("FTS over pointer tokens finds the card holding a 2-char JP term", () => {
    const ids = runSotFtsSearch(db, "掛率", [], [], 10);
    const key = (db.prepare("SELECT source_key FROM contents WHERE id = ?").get(ids[0]) as { source_key: string }).source_key;
    expect(key).toBe("sot:ws-sot:sot/F-001-a.md");
    expect(ids).toHaveLength(1);
  });

  it("returns the card once with matched_sections that carry source_path and source_commit", async () => {
    const page = await searchSemantic(db, "掛率", "ws-sot");
    const top = page.results[0];
    expect(top.title).toContain("F-001-a.md");
    expect(page.results.filter((r) => r.id === top.id)).toHaveLength(1);
    const m = top.matched_sections![0];
    expect(m.source_path).toBe("sot/F-001-a.md");
    expect(m.source_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(m.chunk_key.startsWith("sot/F-001-a.md#")).toBe(true);
    expect(m.heading_path).toBe("見積 › 詳細");
    expect(top.body).not.toContain("重要な値である");
  });
});
