import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(true),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
}));

describe("searchSemantic", () => {
  let db: Database.Database;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { isModelReady, getEmbedding } = await import("../../src/embedding/model.js");
    vi.mocked(isModelReady).mockReturnValue(true);
    vi.mocked(getEmbedding).mockResolvedValue(new Float32Array(384).fill(0.1));

    db = createTestDb();
    await createContent(db, "proj-a", "auth", "idea", "authentication OAuth2 login flow");
    await createContent(db, "proj-a", "auth", "spec", "OAuth2 token refresh implementation spec");
    await createContent(db, "proj-a", "search", "plan", "full text search plan with FTS5");
    await createContent(db, "proj-b", "api", "idea", "REST API design for authentication");
  });

  it("returns results ordered by similarity (distance asc)", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const page = await searchSemantic(db, "OAuth2 authentication");
    expect(page.results.length).toBeGreaterThan(0);
    for (const r of page.results) {
      expect(typeof r.score).toBe("number");
      expect(r.score).toBeGreaterThanOrEqual(0);
    }
  });

  it("respects limit parameter", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const page = await searchSemantic(db, "auth", undefined, undefined, 2);
    expect(page.results.length).toBeLessThanOrEqual(2);
  });

  it("clamps limit to max 50", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const page = await searchSemantic(db, "auth", undefined, undefined, 999);
    expect(page.results.length).toBeLessThanOrEqual(50);
  });

  it("filters by workspace", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const page = await searchSemantic(db, "auth", "proj-a");
    expect(page.results.every((r) => r.workspace === "proj-a")).toBe(true);
  });

  it("filters by type", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const page = await searchSemantic(db, "auth", undefined, "spec");
    expect(page.results.every((r) => r.type === "spec")).toBe(true);
  });

  it("throws when model is not ready", async () => {
    const { isModelReady } = await import("../../src/embedding/model.js");
    vi.mocked(isModelReady).mockReturnValue(false);

    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    await expect(searchSemantic(db, "anything")).rejects.toThrow(/npx @vulhdev\/knowledge-base init/);
  });

  it("returns empty page on query error", async () => {
    const { getEmbedding } = await import("../../src/embedding/model.js");
    vi.mocked(getEmbedding).mockRejectedValue(new Error("model error"));

    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const page = await searchSemantic(db, "auth");
    expect(page.results).toEqual([]);
    expect(page.has_more).toBe(false);
  });

  it("surfaces keyword-matched doc via BM25 — hybrid RRF ranks it above equal-distance vec results", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    // All mock embeddings are identical so vec distance is equal for every doc.
    // The "FTS5" token uniquely appears in one doc body — BM25 should push it to rank 1.
    const page = await searchSemantic(db, "FTS5 full text search");
    expect(page.results.length).toBeGreaterThan(0);
    expect(page.results[0].body).toContain("FTS5");
  });

  it("includes FTS-only hits not in ANN pool when pool is small", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    // With limit=1, internalK=5. There are 4 docs and all have equal vec distance,
    // so all 4 are in the ANN pool. FTS finds "FTS5" doc — verify it surfaces in top result.
    const page = await searchSemantic(db, "FTS5", undefined, undefined, 1);
    expect(page.results).toHaveLength(1);
    expect(page.results[0].body).toContain("FTS5");
  });

  it("offset=0 gives same results as no offset", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const pageDefault = await searchSemantic(db, "auth");
    const pageZero = await searchSemantic(db, "auth", undefined, undefined, 10, 0);
    // Compare IDs and order only — scores differ by a few ULPs because recency
    // uses Date.now() and the two calls happen milliseconds apart.
    expect(pageZero.results.map(r => r.id)).toEqual(pageDefault.results.map(r => r.id));
    expect(pageZero.offset).toBe(0);
  });

  it("offset skips first N results and returns non-overlapping slice", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const page1 = await searchSemantic(db, "auth", undefined, undefined, 2, 0);
    const page2 = await searchSemantic(db, "auth", undefined, undefined, 2, 2);
    const ids1 = new Set(page1.results.map(r => r.id));
    const ids2 = new Set(page2.results.map(r => r.id));
    const overlap = [...ids2].filter(id => ids1.has(id));
    expect(overlap).toHaveLength(0);
  });

  it("has_more is false when all results fit in one page", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const page = await searchSemantic(db, "auth", undefined, undefined, 50, 0);
    expect(page.has_more).toBe(false);
  });

  it("has_more is true when pool has more results beyond offset + limit", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    // 4 docs in db; requesting limit=1 with internalK=5 — pool holds all 4
    const page = await searchSemantic(db, "auth", undefined, undefined, 1, 0);
    expect(page.has_more).toBe(true);
    expect(page.total_in_pool).toBeGreaterThan(1);
  });

  it("has_more is false on last page", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    // 4 docs; offset=3, limit=10 — only 1 doc left, no more after
    const page = await searchSemantic(db, "auth", undefined, undefined, 10, 3);
    expect(page.has_more).toBe(false);
  });

  it("newer doc ranks higher than older doc with same RRF score", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    // sqlite-vec breaks ties by rowid DESC (newest insertion first).
    // docRecent gets lower id; docOld gets higher id and would win the tie without recency boost.
    // After recency boost, docRecent (updated today) outscores docOld (updated 90 days ago).
    await createContent(db, "ws-recency", "feat", "doc", "identical recency test body"); // lower id = docRecent
    await createContent(db, "ws-recency", "feat", "doc", "identical recency test body"); // higher id = docOld

    const ids = (db
      .prepare(`SELECT c.id FROM contents c
        JOIN features f ON c.feature_id = f.id
        JOIN workspaces w ON f.workspace_id = w.id
        WHERE w.name = 'ws-recency' ORDER BY c.id ASC`)
      .all() as { id: number }[]).map(r => r.id);
    const [recentId, oldId] = ids;

    // Backdate the second (higher-rowid) doc so it loses the recency contest
    db.prepare("UPDATE contents SET updated_at = datetime('now', '-90 days') WHERE id = ?").run(oldId);

    const page = await searchSemantic(db, "recency test", "ws-recency");
    expect(page.results.length).toBe(2);
    // docRecent should rank first because it has a higher recency boost
    expect(page.results[0].id).toBe(recentId);
  });

  it("title match ranks above equal-body doc without title match", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    // All vec embeddings are identical (mocked). The unique keyword "zebraftsterm" appears
    // ONLY in the title of the first doc. sqlite-vec breaks ties by rowid DESC (newest first),
    // so without FTS the second doc (no keyword, higher rowid) would rank first.
    // FTS indexes title and BM25 boosts the title-match doc to rank 1.
    await createContent(db, "ws-title", "feat", "doc", "identical neutral body", "zebraftsterm feature");
    await createContent(db, "ws-title", "feat", "doc", "identical neutral body");

    const page = await searchSemantic(db, "zebraftsterm", "ws-title");
    expect(page.results.length).toBeGreaterThan(0);
    expect(page.results[0].title).toBe("zebraftsterm feature");
  });
});
