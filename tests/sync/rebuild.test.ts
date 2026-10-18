import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../setup.js";
import type Database from "better-sqlite3";

describe("rebuildFts", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("runs without throwing on empty contents table", async () => {
    const { rebuildFts } = await import("../../src/sync/rebuild.js");
    expect(() => rebuildFts(db)).not.toThrow();
  });

  it("makes existing content findable via FTS after rebuild", async () => {
    const { rebuildFts } = await import("../../src/sync/rebuild.js");
    db.prepare("INSERT INTO contents (type, body) VALUES ('idea', 'uniquerebuildterm')").run();
    // Simulate FTS being out of sync by corrupting it
    db.exec("DELETE FROM contents_fts");
    rebuildFts(db);
    const rows = db
      .prepare("SELECT rowid FROM contents_fts WHERE contents_fts MATCH 'uniquerebuildterm'")
      .all();
    expect(rows.length).toBeGreaterThan(0);
  });
});
