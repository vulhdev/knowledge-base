import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { getContent } from "../../src/tools/get-content.js";
import { deleteContent } from "../../src/tools/delete-content.js";

describe("deleteContent", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns the deleted document", () => {
    const created = createContent(db, "proj", "auth", "spec", "spec body");
    const deleted = deleteContent(db, created.id);
    expect(deleted.id).toBe(created.id);
    expect(deleted.workspace).toBe("proj");
    expect(deleted.feature).toBe("auth");
    expect(deleted.type).toBe("spec");
    expect(deleted.body).toBe("spec body");
  });

  it("removes the document from the database", () => {
    const created = createContent(db, "proj", "auth", "idea", "some idea");
    deleteContent(db, created.id);
    expect(() => getContent(db, created.id)).toThrow(/not found/i);
  });

  it("throws a not-found error for a missing id", () => {
    expect(() => deleteContent(db, 999)).toThrow(/not found/i);
  });

  it("deletes only the targeted document when multiple exist", () => {
    const a = createContent(db, "ws", "ft", "idea", "idea a");
    const b = createContent(db, "ws", "ft", "plan", "plan b");
    deleteContent(db, a.id);
    expect(() => getContent(db, a.id)).toThrow(/not found/i);
    expect(getContent(db, b.id).body).toBe("plan b");
  });
});
