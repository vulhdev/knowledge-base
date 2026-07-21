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
    const results = await searchSemantic(db, "OAuth2 authentication");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(typeof r.score).toBe("number");
      expect(r.score).toBeGreaterThanOrEqual(0);
    }
  });

  it("respects limit parameter", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const results = await searchSemantic(db, "auth", undefined, undefined, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("clamps limit to max 50", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const results = await searchSemantic(db, "auth", undefined, undefined, 999);
    expect(results.length).toBeLessThanOrEqual(50);
  });

  it("filters by workspace", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const results = await searchSemantic(db, "auth", "proj-a");
    expect(results.every((r) => r.workspace === "proj-a")).toBe(true);
  });

  it("filters by type", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const results = await searchSemantic(db, "auth", undefined, "spec");
    expect(results.every((r) => r.type === "spec")).toBe(true);
  });

  it("throws when model is not ready", async () => {
    const { isModelReady } = await import("../../src/embedding/model.js");
    vi.mocked(isModelReady).mockReturnValue(false);

    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    await expect(searchSemantic(db, "anything")).rejects.toThrow(/npx @vulhdev\/knowledge-base init/);
  });

  it("returns empty array on query error", async () => {
    const { getEmbedding } = await import("../../src/embedding/model.js");
    vi.mocked(getEmbedding).mockRejectedValue(new Error("model error"));

    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const results = await searchSemantic(db, "auth");
    expect(results).toEqual([]);
  });

  it("surfaces keyword-matched doc via BM25 — hybrid RRF ranks it above equal-distance vec results", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    // All mock embeddings are identical so vec distance is equal for every doc.
    // The "FTS5" token uniquely appears in one doc body — BM25 should push it to rank 1.
    const results = await searchSemantic(db, "FTS5 full text search");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].body).toContain("FTS5");
  });

  it("includes FTS-only hits not in ANN pool when pool is small", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    // With limit=1, internalK=5. There are 4 docs and all have equal vec distance,
    // so all 4 are in the ANN pool. FTS finds "FTS5" doc — verify it surfaces in top result.
    const results = await searchSemantic(db, "FTS5", undefined, undefined, 1);
    expect(results).toHaveLength(1);
    expect(results[0].body).toContain("FTS5");
  });

  it("title match ranks above equal-body doc without title match", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    // All vec embeddings are identical (mocked). The unique keyword "zebraftsterm" appears
    // ONLY in the title of the first doc. sqlite-vec breaks ties by rowid DESC (newest first),
    // so without FTS the second doc (no keyword, higher rowid) would rank first.
    // After the fix, FTS indexes title and BM25 boosts the title-match doc to rank 1.
    await createContent(db, "ws-title", "feat", "doc", "identical neutral body", "zebraftsterm feature");
    await createContent(db, "ws-title", "feat", "doc", "identical neutral body");

    const results = await searchSemantic(db, "zebraftsterm", "ws-title");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe("zebraftsterm feature");
  });
});
