import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { createVersion } from "../../src/tools/create-version.js";
import { listVersions } from "../../src/tools/list-versions.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("listVersions", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("throws for unknown id", () => {
    expect(() => listVersions(db, 999)).toThrow("Content not found: id=999");
  });

  it("returns single-version doc as array of length 1", async () => {
    const original = await createContent(db, "ws", ["feat"], "spec", "v1 body");
    const result = listVersions(db, original.id);

    expect(result.root_id).toBe(original.id);
    expect(result.versions).toHaveLength(1);
    expect(result.versions[0].id).toBe(original.id);
    expect(result.versions[0].version_number).toBe(1);
    expect(result.versions[0].is_latest).toBe(true);
  });

  it("returns versions sorted ASC by version_number", async () => {
    const original = await createContent(db, "ws", ["feat"], "spec", "v1");
    const v2 = createVersion(db, original.id);
    const v3 = createVersion(db, v2.content.id);

    const result = listVersions(db, original.id);
    expect(result.versions.map((v) => v.version_number)).toEqual([1, 2, 3]);
    expect(result.versions.map((v) => v.is_latest)).toEqual([false, false, true]);
  });

  it("callable with non-root version id — returns same result as root", async () => {
    const original = await createContent(db, "ws", ["feat"], "spec", "v1");
    const v2 = createVersion(db, original.id);

    const fromRoot = listVersions(db, original.id);
    const fromV2 = listVersions(db, v2.content.id);

    expect(fromRoot.root_id).toBe(fromV2.root_id);
    expect(fromRoot.versions.map((v) => v.id)).toEqual(fromV2.versions.map((v) => v.id));
  });

  it("is_latest flag is correct on each version", async () => {
    const original = await createContent(db, "ws", ["feat"], "spec", "v1");
    createVersion(db, original.id);
    const v3 = createVersion(db, original.id);

    const result = listVersions(db, original.id);
    const latestIds = result.versions.filter((v) => v.is_latest).map((v) => v.id);
    expect(latestIds).toEqual([v3.content.id]);
  });

  it("includes title for each version summary", async () => {
    const original = await createContent(db, "ws", ["feat"], "spec", "v1 body", "My Doc");
    const result = listVersions(db, original.id);
    expect(result.versions[0].title).toBe("My Doc");
  });
});
