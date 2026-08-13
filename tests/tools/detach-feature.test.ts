import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { attachFeature } from "../../src/tools/attach-feature.js";
import { detachFeature } from "../../src/tools/detach-feature.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("detachFeature", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("removes a feature from a multi-feature document", async () => {
    const c = await createContent(db, "ws", ["auth", "api"], "spec", "body");
    const result = detachFeature(db, c.id, "ws", "api");
    expect(result.content_id).toBe(c.id);
    expect(result.features).toEqual(["auth"]);
  });

  it("throws when trying to detach the last feature", async () => {
    const c = await createContent(db, "ws", ["auth"], "spec", "body");
    expect(() => detachFeature(db, c.id, "ws", "auth")).toThrow(/cannot detach last feature/i);
  });

  it("throws when content does not exist", () => {
    expect(() => detachFeature(db, 9999, "ws", "auth")).toThrow(/Content not found/);
  });

  it("throws when content is in a different workspace", async () => {
    const c = await createContent(db, "ws-a", ["feat"], "spec", "body");
    expect(() => detachFeature(db, c.id, "ws-b", "feat")).toThrow(/Content not found/);
  });

  it("throws when feature does not exist in workspace", async () => {
    const c = await createContent(db, "ws", ["auth"], "spec", "body");
    expect(() => detachFeature(db, c.id, "ws", "nonexistent")).toThrow(/not found/);
  });

  it("throws when content is not attached to the feature", async () => {
    await createContent(db, "ws", ["other"], "spec", "other body");
    const c = await createContent(db, "ws", ["auth"], "spec", "body");
    expect(() => detachFeature(db, c.id, "ws", "other")).toThrow(/not attached/);
  });

  it("returns remaining features sorted alphabetically after detach", async () => {
    const c = await createContent(db, "ws", ["auth"], "spec", "body");
    attachFeature(db, c.id, "ws", "zebra");
    attachFeature(db, c.id, "ws", "alpha");
    const result = detachFeature(db, c.id, "ws", "zebra");
    expect(result.features).toEqual(["alpha", "auth"]);
  });
});
