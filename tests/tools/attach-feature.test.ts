import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { attachFeature } from "../../src/tools/attach-feature.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("attachFeature", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("adds a new feature to an existing document", async () => {
    const c = await createContent(db, "ws", ["auth"], "spec", "body");
    const result = attachFeature(db, c.id, "ws", "api");
    expect(result.content_id).toBe(c.id);
    expect(result.features).toContain("auth");
    expect(result.features).toContain("api");
    expect(result.features).toHaveLength(2);
  });

  it("returns features sorted alphabetically", async () => {
    const c = await createContent(db, "ws", ["zebra"], "spec", "body");
    attachFeature(db, c.id, "ws", "alpha");
    const result = attachFeature(db, c.id, "ws", "mid");
    expect(result.features).toEqual(["alpha", "mid", "zebra"]);
  });

  it("is a no-op when feature is already attached", async () => {
    const c = await createContent(db, "ws", ["auth"], "spec", "body");
    const result = attachFeature(db, c.id, "ws", "auth");
    expect(result.features).toEqual(["auth"]);
  });

  it("creates the feature if it does not exist yet", async () => {
    const c = await createContent(db, "ws", ["auth"], "spec", "body");
    const result = attachFeature(db, c.id, "ws", "brand-new-feature");
    expect(result.features).toContain("brand-new-feature");
  });

  it("throws when content does not exist", () => {
    expect(() => attachFeature(db, 9999, "ws", "auth")).toThrow(/Content not found/);
  });

  it("throws when content is in a different workspace", async () => {
    const c = await createContent(db, "ws-a", ["feat"], "spec", "body");
    expect(() => attachFeature(db, c.id, "ws-b", "feat")).toThrow(/Content not found/);
  });

  it("throws when attaching a digest to a feature that already has a digest", async () => {
    await createContent(db, "ws", ["auth"], "digest", "digest body");
    const c2 = await createContent(db, "ws", ["other"], "digest", "another digest");
    expect(() => attachFeature(db, c2.id, "ws", "auth")).toThrow(/already has a digest/);
  });

  it("allows attaching a non-digest to a feature that has a digest", async () => {
    await createContent(db, "ws", ["auth"], "digest", "digest body");
    const c2 = await createContent(db, "ws", ["other"], "spec", "spec body");
    const result = attachFeature(db, c2.id, "ws", "auth");
    expect(result.features).toContain("auth");
  });
});
