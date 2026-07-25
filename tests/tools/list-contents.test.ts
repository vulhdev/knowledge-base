import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { listContents } from "../../src/tools/list-contents.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("listContents", () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = createTestDb();
    await createContent(db, "proj-a", "auth", "idea", "auth idea");
    await createContent(db, "proj-a", "auth", "spec", "auth spec");
    await createContent(db, "proj-a", "search", "plan", "search plan");
    await createContent(db, "proj-b", "auth", "idea", "other project idea");
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
    expect(results.every((r) => r.feature === "auth")).toBe(true);
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
    await createContent(db, "proj-a", "auth", "doc", "some doc body", "Auth Doc");
    const { results } = listContents(db, "proj-a");
    expect(results.some((r) => r.type === "doc")).toBe(true);
  });

  it("returns title value when set", async () => {
    await createContent(db, "proj-a", "auth", "doc", "doc body", "Titled Doc");
    const { results } = listContents(db, "proj-a", "auth", "doc");
    expect(results[0].title).toBe("Titled Doc");
  });

  it("filters by custom type string", async () => {
    await createContent(db, "proj-a", "auth", "issue" as any, "a bug report");
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
