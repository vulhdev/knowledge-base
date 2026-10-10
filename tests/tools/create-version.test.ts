import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { createVersion } from "../../src/tools/create-version.js";
import { getContent } from "../../src/tools/get-content.js";
import { listVersions } from "../../src/tools/list-versions.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("createVersion", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("throws for unknown id", () => {
    expect(() => createVersion(db, 999)).toThrow("Content not found: id=999");
  });

  it("creates v2 from a single-version doc", async () => {
    const original = await createContent(db, "ws", ["feat"], "spec", "v1 body", "My Spec");
    const result = createVersion(db, original.id);

    expect(result.previous_version_id).toBe(original.id);
    expect(result.content.version_number).toBe(2);
    expect(result.content.root_id).toBe(original.id);
    expect(result.content.body).toBe("v1 body");
    expect(result.content.title).toBe("My Spec");
    expect(result.content.workspace).toBe("ws");
    expect(result.content.features).toEqual(["feat"]);
  });

  it("sets is_latest=1 on new version and is_latest=0 on previous", async () => {
    const original = await createContent(db, "ws", ["feat"], "spec", "v1 body");
    const result = createVersion(db, original.id);

    const v1 = db.prepare("SELECT is_latest FROM contents WHERE id = ?").get(original.id) as { is_latest: number };
    const v2 = db.prepare("SELECT is_latest FROM contents WHERE id = ?").get(result.content.id) as { is_latest: number };

    expect(v1.is_latest).toBe(0);
    expect(v2.is_latest).toBe(1);
  });

  it("creates v3 when called on v2 (non-root version id)", async () => {
    const original = await createContent(db, "ws", ["feat"], "spec", "v1");
    const v2 = createVersion(db, original.id);
    const v3 = createVersion(db, v2.content.id);

    expect(v3.content.version_number).toBe(3);
    expect(v3.content.root_id).toBe(original.id);
  });

  it("is callable with any version id in chain — always increments max", async () => {
    const original = await createContent(db, "ws", ["feat"], "spec", "v1");
    const v2 = createVersion(db, original.id);
    // call with root id even though v2 is now latest
    const v3 = createVersion(db, original.id);

    expect(v3.content.version_number).toBe(3);
    // v2 should also be non-latest now
    const v2Row = db.prepare("SELECT is_latest FROM contents WHERE id = ?").get(v2.content.id) as { is_latest: number };
    expect(v2Row.is_latest).toBe(0);
  });

  it("copies content_features to new version", async () => {
    const original = await createContent(db, "ws", ["alpha", "beta"], "spec", "v1");
    const result = createVersion(db, original.id);

    expect(result.content.features.sort()).toEqual(["alpha", "beta"]);
  });

  it("does not copy code_refs to new version", async () => {
    const original = await createContent(db, "ws", ["feat"], "plan", "v1");
    db.prepare(
      "INSERT INTO code_refs (content_id, commit_hash, file_paths) VALUES (?, ?, ?)",
    ).run(original.id, "abc1234", JSON.stringify([{ path: "src/foo.ts" }]));

    const result = createVersion(db, original.id);
    const codeRefs = db
      .prepare("SELECT id FROM code_refs WHERE content_id = ?")
      .all(result.content.id) as { id: number }[];

    expect(codeRefs).toHaveLength(0);
  });

  it("version_count on get_content reflects the chain size", async () => {
    const original = await createContent(db, "ws", ["feat"], "spec", "v1");
    expect(getContent(db, original.id).version_count).toBe(1);

    createVersion(db, original.id);
    expect(getContent(db, original.id).version_count).toBe(2);
  });

  it("list_versions shows both versions after create", async () => {
    const original = await createContent(db, "ws", ["feat"], "spec", "v1");
    const v2 = createVersion(db, original.id);

    const lv = listVersions(db, original.id);
    expect(lv.versions).toHaveLength(2);
    expect(lv.versions[0].id).toBe(original.id);
    expect(lv.versions[0].is_latest).toBe(false);
    expect(lv.versions[1].id).toBe(v2.content.id);
    expect(lv.versions[1].is_latest).toBe(true);
  });
});
