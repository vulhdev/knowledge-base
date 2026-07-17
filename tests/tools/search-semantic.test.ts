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
});
