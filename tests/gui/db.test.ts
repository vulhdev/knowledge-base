import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { listFeatures, listWorkspaceSummaries, listRecentContents } from "../../src/gui/db.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("listFeatures", () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = createTestDb();
    await createContent(db, "proj-a", "auth", "idea", "auth idea");
    await createContent(db, "proj-a", "auth", "spec", "auth spec");
    await createContent(db, "proj-a", "search", "plan", "search plan");
    await createContent(db, "proj-b", "payments", "idea", "payments idea");
  });

  it("returns features for a workspace sorted by name", () => {
    const features = listFeatures(db, "proj-a");
    expect(features.map((f) => f.name)).toEqual(["auth", "search"]);
  });

  it("returns empty array for unknown workspace", () => {
    expect(listFeatures(db, "nonexistent")).toEqual([]);
  });

  it("does not return features from other workspaces", () => {
    const features = listFeatures(db, "proj-a");
    expect(features.some((f) => f.name === "payments")).toBe(false);
  });

  it("returns each feature only once even with multiple contents", () => {
    const features = listFeatures(db, "proj-a");
    const authFeatures = features.filter((f) => f.name === "auth");
    expect(authFeatures).toHaveLength(1);
  });
});

describe("listWorkspaceSummaries", () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = createTestDb();
  });

  it("returns all workspaces with feature count and last_updated", async () => {
    await createContent(db, "proj-a", "auth", "spec", "auth spec");
    await createContent(db, "proj-a", "search", "plan", "search plan");
    await createContent(db, "proj-b", "payments", "idea", "payments idea");

    const summaries = listWorkspaceSummaries(db);
    expect(summaries).toHaveLength(2);

    const a = summaries.find((s) => s.name === "proj-a")!;
    expect(a.feature_count).toBe(2);
    expect(a.last_updated).toBeTruthy();

    const b = summaries.find((s) => s.name === "proj-b")!;
    expect(b.feature_count).toBe(1);
    expect(b.last_updated).toBeTruthy();
  });

  it("returns feature_count 0 and last_updated null for workspace with no features", async () => {
    await createContent(db, "proj-a", "auth", "spec", "auth spec");
    db.prepare("INSERT INTO workspaces (name) VALUES ('empty-ws')").run();

    const summaries = listWorkspaceSummaries(db);
    const empty = summaries.find((s) => s.name === "empty-ws")!;
    expect(empty.feature_count).toBe(0);
    expect(empty.last_updated).toBeNull();
  });

  it("returns workspaces ordered by name", async () => {
    await createContent(db, "zebra", "feat", "idea", "z");
    await createContent(db, "alpha", "feat", "idea", "a");

    const summaries = listWorkspaceSummaries(db);
    expect(summaries[0].name).toBe("alpha");
    expect(summaries[summaries.length - 1].name).toBe("zebra");
  });
});

describe("listRecentContents", () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = createTestDb();
  });

  it("returns contents sorted by MAX(created_at, updated_at) DESC", async () => {
    const old = await createContent(db, "ws-a", "feat", "idea", "old body", "Old Doc");
    const newer = await createContent(db, "ws-a", "feat", "spec", "new body", "New Doc");
    db.prepare("UPDATE contents SET created_at = '2020-01-01T00:00:00.000Z', updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(old.id);
    db.prepare("UPDATE contents SET created_at = '2025-01-01T00:00:00.000Z', updated_at = '2025-01-01T00:00:00.000Z' WHERE id = ?").run(newer.id);

    const results = listRecentContents(db, 10);
    expect(results[0].title).toBe("New Doc");
    expect(results[1].title).toBe("Old Doc");
  });

  it("respects the limit parameter", async () => {
    await createContent(db, "ws-a", "feat", "idea", "a");
    await createContent(db, "ws-a", "feat", "idea", "b");
    await createContent(db, "ws-a", "feat", "idea", "c");

    const results = listRecentContents(db, 2);
    expect(results).toHaveLength(2);
  });

  it("returns cross-workspace results", async () => {
    await createContent(db, "ws-a", "feat", "idea", "body a", "Doc A");
    await createContent(db, "ws-b", "feat", "spec", "body b", "Doc B");

    const results = listRecentContents(db, 10);
    const workspaces = results.map((r) => r.workspace);
    expect(workspaces).toContain("ws-a");
    expect(workspaces).toContain("ws-b");
  });

  it("returns empty array when no contents exist", () => {
    const results = listRecentContents(db);
    expect(results).toEqual([]);
  });

  it("touched_at reflects updated_at when content is updated after creation", async () => {
    const result = await createContent(db, "ws-a", "feat", "idea", "original", "My Doc");
    db.prepare("UPDATE contents SET updated_at = '2030-01-01T00:00:00.000Z' WHERE id = ?").run(result.id);

    const results = listRecentContents(db, 1);
    expect(results[0].touched_at).toBe("2030-01-01T00:00:00.000Z");
  });
});
