import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { listFeatures, listWorkspaceSummaries } from "../../src/gui/db.js";

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
