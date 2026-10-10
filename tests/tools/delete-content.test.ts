import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { getContent } from "../../src/tools/get-content.js";
import { deleteContent } from "../../src/tools/delete-content.js";
import { createVersion } from "../../src/tools/create-version.js";
import { listVersions } from "../../src/tools/list-versions.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("deleteContent", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns the deleted document", async () => {
    const created = await createContent(db, "proj", ["auth"], "spec", "spec body");
    const deleted = deleteContent(db, created.id);
    expect(deleted.id).toBe(created.id);
    expect(deleted.workspace).toBe("proj");
    expect(deleted.features).toEqual(["auth"]);
    expect(deleted.type).toBe("spec");
    expect(deleted.body).toBe("spec body");
  });

  it("removes the document from the database", async () => {
    const created = await createContent(db, "proj", ["auth"], "idea", "some idea");
    deleteContent(db, created.id);
    expect(() => getContent(db, created.id)).toThrow(/not found/i);
  });

  it("throws a not-found error for a missing id", () => {
    expect(() => deleteContent(db, 999)).toThrow(/not found/i);
  });

  it("deletes only the targeted document when multiple exist", async () => {
    const a = await createContent(db, "ws", ["ft"], "idea", "idea a");
    const b = await createContent(db, "ws", ["ft"], "plan", "plan b");
    deleteContent(db, a.id);
    expect(() => getContent(db, a.id)).toThrow(/not found/i);
    expect(getContent(db, b.id).body).toBe("plan b");
  });

  describe("versioning paths", () => {
    it("path 1: sole version — deletes normally", async () => {
      const doc = await createContent(db, "ws", ["ft"], "spec", "v1");
      deleteContent(db, doc.id);
      expect(() => getContent(db, doc.id)).toThrow(/not found/i);
    });

    it("path 2: non-root version — deletes only that row and renumbers", async () => {
      const doc = await createContent(db, "ws", ["ft"], "spec", "v1");
      const v2 = createVersion(db, doc.id);
      const v3 = createVersion(db, v2.content.id);

      deleteContent(db, v2.content.id);

      expect(() => getContent(db, v2.content.id)).toThrow(/not found/i);
      // v1 and v3 still exist
      const v1row = db.prepare("SELECT version_number FROM contents WHERE id = ?").get(doc.id) as { version_number: number };
      const v3row = db.prepare("SELECT version_number FROM contents WHERE id = ?").get(v3.content.id) as { version_number: number };
      expect(v1row.version_number).toBe(1);
      expect(v3row.version_number).toBe(2); // renumbered from 3 → 2
    });

    it("path 2: restores is_latest when latest non-root is deleted", async () => {
      const doc = await createContent(db, "ws", ["ft"], "spec", "v1");
      const v2 = createVersion(db, doc.id);

      deleteContent(db, v2.content.id); // delete latest

      const versions = listVersions(db, doc.id);
      expect(versions.versions).toHaveLength(1);
      expect(versions.versions[0].is_latest).toBe(true);
      expect(versions.versions[0].id).toBe(doc.id);
    });

    it("path 3: root version — promotes v2 to root", async () => {
      const doc = await createContent(db, "ws", ["ft"], "spec", "v1");
      const v2 = createVersion(db, doc.id);
      const v3 = createVersion(db, v2.content.id);

      deleteContent(db, doc.id); // delete root

      expect(() => getContent(db, doc.id)).toThrow(/not found/i);

      // v2 is now root
      const v2row = db.prepare("SELECT root_id, version_number FROM contents WHERE id = ?").get(v2.content.id) as { root_id: number | null; version_number: number };
      expect(v2row.root_id).toBeNull();
      expect(v2row.version_number).toBe(1);

      // v3's root_id points to v2
      const v3row = db.prepare("SELECT root_id, version_number FROM contents WHERE id = ?").get(v3.content.id) as { root_id: number | null; version_number: number };
      expect(v3row.root_id).toBe(v2.content.id);
      expect(v3row.version_number).toBe(2);
    });

    it("path 4: cascade=true — deletes entire chain", async () => {
      const doc = await createContent(db, "ws", ["ft"], "spec", "v1");
      const v2 = createVersion(db, doc.id);
      const v3 = createVersion(db, v2.content.id);

      deleteContent(db, doc.id, true);

      expect(() => getContent(db, doc.id)).toThrow(/not found/i);
      expect(() => getContent(db, v2.content.id)).toThrow(/not found/i);
      expect(() => getContent(db, v3.content.id)).toThrow(/not found/i);
    });

    it("path 4: cascade=true callable with any version id", async () => {
      const doc = await createContent(db, "ws", ["ft"], "spec", "v1");
      const v2 = createVersion(db, doc.id);

      deleteContent(db, v2.content.id, true); // called with non-root

      expect(() => getContent(db, doc.id)).toThrow(/not found/i);
      expect(() => getContent(db, v2.content.id)).toThrow(/not found/i);
    });

    it("deleted row is returned in all versioning paths", async () => {
      const doc = await createContent(db, "ws", ["ft"], "spec", "original body");
      const v2 = createVersion(db, doc.id);

      const deleted = deleteContent(db, v2.content.id);
      expect(deleted.id).toBe(v2.content.id);
      expect(deleted.body).toBe("original body");
    });
  });
});
