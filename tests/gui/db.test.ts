import { describe, it, expect, beforeEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { listFeatures } from "../../src/gui/db.js";

describe("listFeatures", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
    createContent(db, "proj-a", "auth", "idea", "auth idea");
    createContent(db, "proj-a", "auth", "spec", "auth spec");
    createContent(db, "proj-a", "search", "plan", "search plan");
    createContent(db, "proj-b", "payments", "idea", "payments idea");
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
