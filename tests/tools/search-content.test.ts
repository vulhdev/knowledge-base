import { describe, it, expect, beforeEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { searchContent } from "../../src/tools/search-content.js";

describe("searchContent", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
    createContent(db, "proj-a", "auth", "idea", "authentication OAuth2 login flow");
    createContent(db, "proj-a", "auth", "spec", "OAuth2 token refresh implementation spec");
    createContent(db, "proj-a", "search", "plan", "full text search plan with FTS5");
    createContent(db, "proj-b", "api", "idea", "REST API design for authentication");
  });

  it("returns documents matching the query", () => {
    const results = searchContent(db, "OAuth2");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.body.includes("OAuth2"))).toBe(true);
  });

  it("returns empty array when query matches nothing", () => {
    expect(searchContent(db, "zzznomatch")).toEqual([]);
  });

  it("returns results ordered by BM25 relevance (more mentions rank higher)", () => {
    // doc with more occurrences of the keyword should rank first
    const results = searchContent(db, "authentication");
    expect(results.length).toBeGreaterThanOrEqual(2);
    // scores are negative (more negative = more relevant); first should be <= second
    expect(results[0].score).toBeLessThanOrEqual(results[1].score);
  });

  it("each result has a score field", () => {
    const results = searchContent(db, "OAuth2");
    for (const r of results) {
      expect(typeof r.score).toBe("number");
    }
  });

  it("filters by workspace", () => {
    const results = searchContent(db, "authentication", "proj-a");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.workspace === "proj-a")).toBe(true);
  });

  it("returns no results when workspace filter excludes all matches", () => {
    const results = searchContent(db, "FTS5", "proj-b");
    expect(results).toEqual([]);
  });

  it("filters by type", () => {
    const results = searchContent(db, "OAuth2", undefined, "spec");
    expect(results.every((r) => r.type === "spec")).toBe(true);
  });

  it("clamps limit to max 50", () => {
    for (let i = 0; i < 60; i++) {
      createContent(db, "bulk", "ft", "idea", `document number ${i} with keyword bulk`);
    }
    const results = searchContent(db, "bulk", undefined, undefined, 999);
    expect(results.length).toBeLessThanOrEqual(50);
  });

  it("defaults limit to 10", () => {
    for (let i = 0; i < 15; i++) {
      createContent(db, "many", "ft", "idea", `extra document item ${i}`);
    }
    const results = searchContent(db, "extra");
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it("returns empty array on invalid FTS syntax instead of throwing", () => {
    expect(() => searchContent(db, 'AND OR "unclosed')).not.toThrow();
    expect(searchContent(db, 'AND OR "unclosed')).toEqual([]);
  });

  it("FTS index stays consistent after delete", () => {
    const r = createContent(db, "ws", "ft", "idea", "deleteMe uniqueword123");
    expect(searchContent(db, "uniqueword123")).toHaveLength(1);
    db.prepare("DELETE FROM contents WHERE id = ?").run(r.id);
    expect(searchContent(db, "uniqueword123")).toHaveLength(0);
  });

  it("FTS index updates after body change", () => {
    const r = createContent(db, "ws", "ft", "idea", "original content word");
    db.prepare("UPDATE contents SET body = ? WHERE id = ?").run("updated content newword", r.id);
    expect(searchContent(db, "word")).toHaveLength(0);
    expect(searchContent(db, "newword")).toHaveLength(1);
  });

  it("includes title field in search results", () => {
    createContent(db, "proj-a", "auth", "doc", "authentication OAuth2 login", "Auth Doc");
    const results = searchContent(db, "OAuth2");
    expect(results.every((r) => "title" in r)).toBe(true);
    const docResult = results.find((r) => r.type === "doc");
    expect(docResult?.title).toBe("Auth Doc");
  });

  it("returns null title for documents without title", () => {
    const results = searchContent(db, "OAuth2");
    expect(results.some((r) => r.title === null)).toBe(true);
  });

  it("filters by custom type string", () => {
    createContent(db, "proj-a", "auth", "issue" as any, "OAuth2 permission error bug");
    const results = searchContent(db, "OAuth2", undefined, "issue" as any);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.type === "issue")).toBe(true);
  });
});
