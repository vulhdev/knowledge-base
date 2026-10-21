import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { applySchema } from "../../src/db/schema.js";
import { fetchFeatures, fetchFeaturesBatch } from "../../src/tools/_helpers.js";

function buildPreMigration9Db(): Database.Database {
  const db = new Database(":memory:");
  loadSqliteVec(db);

  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE workspaces (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);

    CREATE TABLE features (
      id INTEGER PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      UNIQUE(workspace_id, name)
    );

    CREATE TABLE contents (
      id INTEGER PRIMARY KEY,
      feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT,
      body TEXT NOT NULL,
      embedding BLOB,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX uq_feature_digest ON contents(feature_id) WHERE type = 'digest';
    CREATE INDEX idx_contents_feature_id ON contents(feature_id);

    INSERT INTO workspaces (id, name) VALUES (1, 'ws');
    INSERT INTO features (id, workspace_id, name) VALUES (1, 1, 'feat-a'), (2, 1, 'feat-b');
    INSERT INTO contents (id, feature_id, type, body) VALUES (1, 1, 'idea', 'body1'), (2, 2, 'spec', 'body2');
  `);

  return db;
}

describe("Migration 9: content_features junction table", () => {
  it("fresh DB has content_features and no feature_id in contents", () => {
    const db = new Database(":memory:");
    loadSqliteVec(db);
    applySchema(db);

    const hasFeatureId = (
      db.prepare("SELECT COUNT(*) AS cnt FROM pragma_table_info('contents') WHERE name = 'feature_id'").get() as { cnt: number }
    ).cnt > 0;
    expect(hasFeatureId).toBe(false);

    const hasContentFeatures = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='content_features'")
      .get();
    expect(hasContentFeatures).toBeTruthy();
  });

  it("migrates existing DB: removes feature_id, backfills content_features", () => {
    const db = buildPreMigration9Db();
    applySchema(db);

    const hasFeatureId = (
      db.prepare("SELECT COUNT(*) AS cnt FROM pragma_table_info('contents') WHERE name = 'feature_id'").get() as { cnt: number }
    ).cnt > 0;
    expect(hasFeatureId).toBe(false);

    // After UUID migration, content_ids are UUIDs — check count and feature assignments
    const rows = db
      .prepare("SELECT cf.feature_id, c.type FROM content_features cf JOIN contents c ON c.id = cf.content_id ORDER BY c.type")
      .all() as { feature_id: number; type: string }[];
    expect(rows).toEqual([
      { feature_id: 1, type: "idea" },
      { feature_id: 2, type: "spec" },
    ]);
  });

  it("migration preserves all content rows and data", () => {
    const db = buildPreMigration9Db();
    applySchema(db);

    // After UUID migration, ids are UUIDs — check type and body only
    const rows = db.prepare("SELECT type, body FROM contents ORDER BY type").all();
    expect(rows).toEqual([
      { type: "idea", body: "body1" },
      { type: "spec", body: "body2" },
    ]);
  });

  it("migration is idempotent on already-migrated DB", () => {
    const db = buildPreMigration9Db();
    applySchema(db);
    expect(() => applySchema(db)).not.toThrow();

    const rows = db.prepare("SELECT content_id FROM content_features ORDER BY content_id").all();
    expect(rows).toHaveLength(2);
  });

  it("content_features index exists", () => {
    const db = new Database(":memory:");
    loadSqliteVec(db);
    applySchema(db);

    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_content_features_feature'")
      .get();
    expect(idx).toBeTruthy();
  });

  it("content_features rows exist after migration and can be queried per content", () => {
    const db = buildPreMigration9Db();
    applySchema(db);

    // content_features is a CRR — no FK CASCADE; check that rows exist after migration
    expect((db.prepare("SELECT COUNT(*) AS n FROM content_features").get() as { n: number }).n).toBe(2);
    // Each content has exactly one feature assignment
    const { id: ideaId } = db.prepare("SELECT id FROM contents WHERE type = 'idea'").get() as { id: string };
    expect((db.prepare("SELECT COUNT(*) AS n FROM content_features WHERE content_id = ?").get(ideaId) as { n: number }).n).toBe(1);
  });

  it("legacy DB gets Migration 9 and the Migration 10 contents indexes", () => {
    const db = buildPreMigration9Db();
    const beforeCount = (db.prepare("SELECT COUNT(*) AS n FROM contents").get() as { n: number }).n;
    applySchema(db);

    const hasFeatureId = (
      db.prepare("SELECT COUNT(*) AS cnt FROM pragma_table_info('contents') WHERE name = 'feature_id'").get() as { cnt: number }
    ).cnt > 0;
    expect(hasFeatureId).toBe(false);

    for (const name of ["idx_contents_created_at", "idx_contents_type_created_at"]) {
      const idx = db
        .prepare("SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(name) as { tbl_name: string } | undefined;
      expect(idx?.tbl_name).toBe("contents");
    }

    // After UUID migration, content_features rows are preserved (same count as original contents)
    const afterCount = (db.prepare("SELECT COUNT(*) AS n FROM content_features").get() as { n: number }).n;
    expect(afterCount).toBe(beforeCount);
  });
});

describe("fetchFeatures helper", () => {
  it("returns sorted feature names for a content", () => {
    const db = new Database(":memory:");
    loadSqliteVec(db);
    applySchema(db);

    db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run("ws");
    const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get("ws") as { id: number };
    db.prepare("INSERT OR IGNORE INTO features (workspace_id, name) VALUES (?, ?)").run(ws.id, "beta");
    db.prepare("INSERT OR IGNORE INTO features (workspace_id, name) VALUES (?, ?)").run(ws.id, "alpha");
    const betaId = (db.prepare("SELECT id FROM features WHERE name = ?").get("beta") as { id: number }).id;
    const alphaId = (db.prepare("SELECT id FROM features WHERE name = ?").get("alpha") as { id: number }).id;

    const { lastInsertRowid: lr1 } = db.prepare("INSERT INTO contents (type, body) VALUES (?, ?)").run("idea", "body");
    const { id: contentId } = db.prepare("SELECT id FROM contents WHERE rowid = ?").get(lr1) as { id: string };
    db.prepare("INSERT INTO content_features (content_id, feature_id) VALUES (?, ?)").run(contentId, betaId);
    db.prepare("INSERT INTO content_features (content_id, feature_id) VALUES (?, ?)").run(contentId, alphaId);

    expect(fetchFeatures(db, contentId)).toEqual(["alpha", "beta"]);
  });

  it("returns empty array for content with no features", () => {
    const db = new Database(":memory:");
    loadSqliteVec(db);
    applySchema(db);

    const { lastInsertRowid: lr2 } = db.prepare("INSERT INTO contents (type, body) VALUES (?, ?)").run("idea", "orphan");
    const { id: contentId } = db.prepare("SELECT id FROM contents WHERE rowid = ?").get(lr2) as { id: string };

    expect(fetchFeatures(db, contentId)).toEqual([]);
  });

  it("returns single feature", () => {
    const db = new Database(":memory:");
    loadSqliteVec(db);
    applySchema(db);

    db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run("ws");
    const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get("ws") as { id: number };
    db.prepare("INSERT OR IGNORE INTO features (workspace_id, name) VALUES (?, ?)").run(ws.id, "only");
    const featId = (db.prepare("SELECT id FROM features WHERE name = ?").get("only") as { id: number }).id;

    const { lastInsertRowid: lr3 } = db.prepare("INSERT INTO contents (type, body) VALUES (?, ?)").run("idea", "body");
    const { id: contentId } = db.prepare("SELECT id FROM contents WHERE rowid = ?").get(lr3) as { id: string };
    db.prepare("INSERT INTO content_features (content_id, feature_id) VALUES (?, ?)").run(contentId, featId);

    expect(fetchFeatures(db, contentId)).toEqual(["only"]);
  });
});

describe("fetchFeaturesBatch helper", () => {
  function seed(): { db: Database.Database; multi: string; single: string; orphan: string } {
    const db = new Database(":memory:");
    loadSqliteVec(db);
    applySchema(db);

    db.prepare("INSERT INTO workspaces (name) VALUES (?), (?)").run("ws-a", "ws-b");
    const wsA = (db.prepare("SELECT id FROM workspaces WHERE name = ?").get("ws-a") as { id: number }).id;
    const wsB = (db.prepare("SELECT id FROM workspaces WHERE name = ?").get("ws-b") as { id: number }).id;
    const insertFeature = db.prepare("INSERT INTO features (workspace_id, name) VALUES (?, ?)");
    const zeta = Number(insertFeature.run(wsA, "zeta").lastInsertRowid);
    const alpha = Number(insertFeature.run(wsB, "alpha").lastInsertRowid);
    const solo = Number(insertFeature.run(wsA, "solo").lastInsertRowid);

    const insertContent = db.prepare("INSERT INTO contents (type, body) VALUES (?, ?)");
    const getUuid = db.prepare("SELECT id FROM contents WHERE rowid = ?");
    const link = db.prepare("INSERT INTO content_features (content_id, feature_id) VALUES (?, ?)");
    const { id: multi } = getUuid.get(insertContent.run("idea", "multi").lastInsertRowid) as { id: string };
    link.run(multi, zeta);
    link.run(multi, alpha);
    const { id: single } = getUuid.get(insertContent.run("spec", "single").lastInsertRowid) as { id: string };
    link.run(single, solo);
    const { id: orphan } = getUuid.get(insertContent.run("plan", "orphan").lastInsertRowid) as { id: string };
    link.run(orphan, solo);
    db.prepare("DELETE FROM content_features WHERE content_id = ?").run(orphan);

    return { db, multi, single, orphan };
  }

  it("returns an empty Map without preparing any statement for an empty id list", () => {
    const { db } = seed();
    const spy = vi.spyOn(db, "prepare");
    spy.mockClear();

    const result = fetchFeaturesBatch(db, []);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("maps every id to its sorted feature names across workspaces and omits feature-less ids", () => {
    const { db, multi, single, orphan } = seed();

    const result = fetchFeaturesBatch(db, [multi, single, orphan]);

    expect(result.get(multi)).toEqual(["alpha", "zeta"]);
    expect(result.get(single)).toEqual(["solo"]);
    expect(result.has(orphan)).toBe(false);
  });

  it("uses a single prepared statement for a non-empty id list", () => {
    const { db, multi, single, orphan } = seed();
    const spy = vi.spyOn(db, "prepare");
    spy.mockClear();

    fetchFeaturesBatch(db, [multi, single, orphan]);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("agrees with fetchFeatures for every id", () => {
    const { db, multi, single, orphan } = seed();

    for (const id of [multi, single, orphan]) {
      expect(fetchFeaturesBatch(db, [id]).get(id) ?? []).toEqual(fetchFeatures(db, id));
    }
  });

  it("treats duplicate ids like the de-duplicated input", () => {
    const { db, multi, single } = seed();

    const withDuplicates = fetchFeaturesBatch(db, [multi, single, multi, single]);
    const deduplicated = fetchFeaturesBatch(db, [multi, single]);

    expect([...withDuplicates.entries()]).toEqual([...deduplicated.entries()]);
  });
});
