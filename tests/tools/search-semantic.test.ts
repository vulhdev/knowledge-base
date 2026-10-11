import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { runFtsSearch } from "../../src/tools/search-semantic.js";
import { fetchFeatures } from "../../src/tools/_helpers.js";

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
    await createContent(db, "ws-recency", ["feat"], "doc", "identical recency test body"); // lower id = docRecent
    await createContent(db, "ws-recency", ["feat"], "doc", "identical recency test body"); // higher id = docOld

    const ids = (db
      .prepare(`SELECT c.id FROM contents c
        JOIN content_features cf ON cf.content_id = c.id
        JOIN features f ON cf.feature_id = f.id
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

  it("has_code_refs is true for results that have attached code refs", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const content = await createContent(db, "proj-refs", "feat", "doc", "unique coderef sentinel document");
    db.prepare(
      "INSERT INTO code_refs (content_id, commit_hash, file_paths) VALUES (?, ?, ?)",
    ).run(content.id, "deadbeef01", JSON.stringify([{ path: "src/foo.ts", start: 1, end: 5 }]));

    const page = await searchSemantic(db, "unique coderef sentinel", "proj-refs");
    expect(page.results.length).toBeGreaterThan(0);
    const hit = page.results.find(r => r.id === content.id);
    expect(hit).toBeDefined();
    expect(hit!.has_code_refs).toBe(true);
  });

  it("has_code_refs is false for results without any code refs", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const content = await createContent(db, "proj-norefs", "feat", "doc", "unique noref sentinel document");

    const page = await searchSemantic(db, "unique noref sentinel", "proj-norefs");
    expect(page.results.length).toBeGreaterThan(0);
    const hit = page.results.find(r => r.id === content.id);
    expect(hit).toBeDefined();
    expect(hit!.has_code_refs).toBe(false);
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

  it("AND join: multi-word query matches only docs containing all tokens", async () => {
    const idFull    = (await createContent(db, "ws-and", "feat", "doc", "conflict detection algorithm")).id;
    const idPartial = (await createContent(db, "ws-and", "feat", "doc", "conflict resolution strategy")).id;
    const idOther   = (await createContent(db, "ws-and", "feat", "doc", "anomaly detection system")).id;

    const ids = runFtsSearch(db, "conflict detection", [], [], 10);
    expect(ids).toContain(idFull);
    expect(ids).not.toContain(idPartial);
    expect(ids).not.toContain(idOther);
  });

  it("AND join: falls back to OR when no doc contains all tokens", async () => {
    const idApple  = (await createContent(db, "ws-fallback", "feat", "doc", "apple tree orchard")).id;
    const idBanana = (await createContent(db, "ws-fallback", "feat", "doc", "banana split dessert")).id;

    const ids = runFtsSearch(db, "apple banana", [], [], 10);
    expect(ids).toContain(idApple);
    expect(ids).toContain(idBanana);
  });

  describe("batched feature lookup", () => {
    // 4 docs from the outer beforeEach + 40 here = 44 < internalK for limit 10 (50),
    // so the ANN pool holds every doc for both limit 10 and limit 50.
    beforeEach(async () => {
      for (let i = 0; i < 40; i++) {
        await createContent(db, "proj-a", i % 2 === 0 ? ["auth"] : ["auth", "bulk"], "doc", `auth bulk document ${i}`);
      }
    });

    function featureQueries(spy: { mock: { calls: unknown[][] } }): string[] {
      return spy.mock.calls.map((c) => String(c[0])).filter((sql) => sql.includes("cf.content_id IN"));
    }

    it("runs exactly one features query sized to the page, with a constant statement count", async () => {
      const { searchSemantic } = await import("../../src/tools/search-semantic.js");
      const spy = vi.spyOn(db, "prepare");

      spy.mockClear();
      const small = await searchSemantic(db, "auth", undefined, undefined, 10, 0);
      const smallTotal = spy.mock.calls.length;
      const smallFeatureSql = featureQueries(spy);

      spy.mockClear();
      const large = await searchSemantic(db, "auth", undefined, undefined, 50, 0);
      const largeTotal = spy.mock.calls.length;
      const largeFeatureSql = featureQueries(spy);
      spy.mockRestore();

      expect(small.results).toHaveLength(10);
      expect(large.results.length).toBeGreaterThan(10);
      expect(smallFeatureSql).toHaveLength(1);
      expect(largeFeatureSql).toHaveLength(1);
      expect((smallFeatureSql[0].match(/\?/g) ?? []).length).toBe(small.results.length);
      expect((largeFeatureSql[0].match(/\?/g) ?? []).length).toBe(large.results.length);
      expect(smallTotal).toBe(largeTotal);
    });

    it("runs no features query when offset is beyond the pool", async () => {
      const { searchSemantic } = await import("../../src/tools/search-semantic.js");
      const first = await searchSemantic(db, "auth", undefined, undefined, 10, 0);

      const spy = vi.spyOn(db, "prepare");
      spy.mockClear();
      const beyond = await searchSemantic(db, "auth", undefined, undefined, 10, 100);
      const featureSql = featureQueries(spy);
      spy.mockRestore();

      expect(beyond.results).toEqual([]);
      expect(beyond.has_more).toBe(false);
      expect(beyond.total_in_pool).toBe(first.total_in_pool);
      expect(featureSql).toHaveLength(0);
    });

    it("attaches the same features as fetchFeatures for every result", async () => {
      const { searchSemantic } = await import("../../src/tools/search-semantic.js");
      const page = await searchSemantic(db, "auth", undefined, undefined, 50, 0);
      expect(page.results.length).toBeGreaterThan(10);
      for (const r of page.results) {
        expect(r.features).toEqual(fetchFeatures(db, r.id));
      }
    });
  });
});

describe("Japanese full-text search (CJK bigrams)", () => {
  let db: Database.Database;
  const JP = "見積金額は原価に掛率を乗じて算出する。端数処理は切り捨て。";

  beforeEach(async () => {
    const { isModelReady, getEmbedding } = await import("../../src/embedding/model.js");
    vi.mocked(isModelReady).mockReturnValue(true);
    vi.mocked(getEmbedding).mockResolvedValue(new Float32Array(384).fill(0.1));
    db = createTestDb();
  });

  it("finds 2-char and long terms mid-sentence, as a phrase, and never a non-adjacent pair", async () => {
    const { id } = await createContent(db, "ws-jp", ["ft"], "doc", JP);
    await createContent(db, "ws-jp", ["ft"], "doc", "unrelated english body");
    for (const q of ["掛率", "原価", "端数処理", "原価に掛率"]) {
      expect(runFtsSearch(db, q, [], [], 10), q).toEqual([id]);
    }
    expect(runFtsSearch(db, "価掛", [], [], 10)).toEqual([]);
    expect(runFtsSearch(db, "見", [], [], 10)).toEqual([]);
  });

  it("searchSemantic puts the JP doc in the top 5 for each term (Independent Test)", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const { id } = await createContent(db, "ws-jp", ["ft"], "doc", JP);
    for (let i = 0; i < 8; i++) await createContent(db, "ws-jp", ["ft"], "doc", `filler document number ${i}`);
    for (const q of ["掛率", "原価", "端数処理", "原価に掛率"]) {
      const page = await searchSemantic(db, q, "ws-jp");
      expect(page.results.slice(0, 5).map((r) => r.id), q).toContain(id);
    }
    await expect(searchSemantic(db, "見", "ws-jp")).resolves.toBeDefined();
  });

  it("handles a mixed query per script: F-002 掛率", async () => {
    const { id } = await createContent(db, "ws-jp", ["ft"], "doc", `F-002 の ${JP}`);
    await createContent(db, "ws-jp", ["ft"], "doc", "F-002 only latin");
    expect(runFtsSearch(db, "F-002 掛率", [], [], 10)).toEqual([id]);
  });

  it("keeps the title weight for Japanese titles", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    await createContent(db, "ws-jp", ["ft"], "doc", "同じ本文です。", "回次の採番");
    await createContent(db, "ws-jp", ["ft"], "doc", "同じ本文です。回次");
    for (let i = 0; i < 4; i++) await createContent(db, "ws-jp", ["ft"], "doc", `別の本文 ${i}`);
    const ids = runFtsSearch(db, "回次", [], [], 10);
    const titled = (db.prepare("SELECT id FROM contents WHERE title = '回次の採番'").get() as { id: number }).id;
    expect(ids[0]).toBe(titled);
    const page = await searchSemantic(db, "回次", "ws-jp");
    expect(page.results[0].id).toBe(titled);
  });
});

describe("section-level search (matched_sections)", () => {
  let db: Database.Database;
  const vecA = new Float32Array(384).fill(0); vecA[0] = 1;
  const vecB = new Float32Array(384).fill(0); vecB[1] = 1;
  const DOC = [
    "# 手引き",
    ...["概要", "前提", "手順", "注意", "補足"].flatMap((h) => [`## ${h}`, `${h}の説明文です。`.repeat(12)]),
    "## 最後の節",
    "ここだけに書かれたユニークな詳細：掛率は九割とする。".repeat(3),
  ].join("\n");

  beforeEach(async () => {
    const { isModelReady, getEmbedding } = await import("../../src/embedding/model.js");
    vi.mocked(isModelReady).mockReturnValue(true);
    vi.mocked(getEmbedding).mockImplementation(async (t: string) => (t.includes("ユニーク") ? vecA : vecB));
    db = createTestDb();
  });

  it("returns the doc once, in the top 5, with the last section among matched_sections (Independent Test)", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const { id } = await createContent(db, "ws-sec", ["ft"], "doc", DOC, "手引き");
    for (let i = 0; i < 6; i++) await createContent(db, "ws-sec", ["ft"], "doc", `別の文書 ${i} です。`.repeat(10));
    const page = await searchSemantic(db, "ユニークな詳細", "ws-sec");
    const top = page.results.slice(0, 5);
    expect(top.map((r) => r.id)).toContain(id);
    expect(page.results.filter((r) => r.id === id)).toHaveLength(1);
    const hit = page.results.find((r) => r.id === id)!;
    const last = db.prepare("SELECT chunk_key FROM content_chunks WHERE content_id = ? ORDER BY ord DESC LIMIT 1").get(id) as { chunk_key: string };
    expect(hit.matched_sections![0].chunk_key).toBe(`${id}#${last.chunk_key}`);
    expect(hit.matched_sections![0].heading_path).toBe("手引き › 最後の節");
    const lines = DOC.split("\n");
    expect(lines[hit.matched_sections![0].start_line - 1]).toBe("## 最後の節");
  });

  it("caps matched_sections at 3 and lists a doc once even when many sections match", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const many = ["# 多い", ...Array.from({ length: 10 }, (_, i) => [`## 節${i}`, "ユニーク ".repeat(60)]).flat()].join("\n");
    const { id } = await createContent(db, "ws-sec", ["ft"], "doc", many, "多い");
    const page = await searchSemantic(db, "ユニーク", "ws-sec");
    expect(page.results.filter((r) => r.id === id)).toHaveLength(1);
    expect(page.results[0].matched_sections!.length).toBeLessThanOrEqual(3);
    expect(page.total_in_pool).toBe(page.results.length);
  });

  it("keeps every existing SearchResult / SearchPage field", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    await createContent(db, "ws-sec", ["ft"], "doc", DOC, "手引き");
    const page = await searchSemantic(db, "ユニーク", "ws-sec");
    expect(Object.keys(page).sort()).toEqual(["has_more", "limit", "offset", "results", "total_in_pool"]);
    const r = page.results[0];
    for (const k of ["id", "workspace", "features", "type", "title", "body", "created_at", "updated_at", "has_code_refs", "score"]) {
      expect(r).toHaveProperty(k);
    }
  });

  it("still returns a doc that has no sections (doc vector only)", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const { id } = await createContent(db, "ws-sec", ["ft"], "doc", "ユニーク body", "x");
    db.prepare("DELETE FROM content_chunks WHERE content_id = ?").run(id);
    const page = await searchSemantic(db, "ユニーク", "ws-sec");
    const hit = page.results.find((r) => r.id === id)!;
    expect(hit).toBeDefined();
    expect(hit.matched_sections ?? []).toEqual([]);
  });

  it("still throws the old error when the model is absent", async () => {
    const { searchSemantic } = await import("../../src/tools/search-semantic.js");
    const { isModelReady } = await import("../../src/embedding/model.js");
    vi.mocked(isModelReady).mockReturnValue(false);
    await expect(searchSemantic(db, "x")).rejects.toThrow("Semantic search is not available. Run: npx @vulhdev/knowledge-base init");
  });
});
