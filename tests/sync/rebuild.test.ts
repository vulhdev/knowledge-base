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

  it("content is findable via FTS after insert (trigger-maintained, no rebuild needed)", async () => {
    const { rebuildFts } = await import("../../src/sync/rebuild.js");
    db.prepare("INSERT INTO contents (type, body) VALUES ('idea', 'uniquerebuildterm')").run();
    rebuildFts(db); // no-op — triggers already kept FTS in sync
    const rows = db
      .prepare("SELECT rowid FROM contents_fts WHERE contents_fts MATCH 'uniquerebuildterm'")
      .all();
    expect(rows.length).toBeGreaterThan(0);
  });
});
