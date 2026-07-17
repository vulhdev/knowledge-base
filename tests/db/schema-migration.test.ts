import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { applySchema } from "../../src/db/schema.js";

function createOldSchemaDb(): Database.Database {
  const db = new Database(":memory:");
  loadSqliteVec(db);
  db.exec(`
    CREATE TABLE workspaces (
      id   INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE features (
      id           INTEGER PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      UNIQUE(workspace_id, name)
    );
    CREATE TABLE contents (
      id         INTEGER PRIMARY KEY,
      feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      type       TEXT NOT NULL CHECK(type IN ('idea', 'spec', 'plan', 'digest')),
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX uq_feature_digest ON contents(feature_id) WHERE type = 'digest';
    CREATE VIRTUAL TABLE contents_fts USING fts5(
      body, content=contents, content_rowid=id, tokenize='unicode61'
    );
    CREATE TRIGGER contents_ai AFTER INSERT ON contents BEGIN
      INSERT INTO contents_fts(rowid, body) VALUES (new.id, new.body);
    END;
    CREATE TRIGGER contents_ad AFTER DELETE ON contents BEGIN
      INSERT INTO contents_fts(contents_fts, rowid, body) VALUES ('delete', old.id, old.body);
    END;
    CREATE TRIGGER contents_au AFTER UPDATE ON contents BEGIN
      INSERT INTO contents_fts(contents_fts, rowid, body) VALUES ('delete', old.id, old.body);
      INSERT INTO contents_fts(rowid, body) VALUES (new.id, new.body);
    END;
  `);
  return db;
}

describe("schema migrations", () => {
  it("adds title column to existing DB without losing rows", () => {
    const db = createOldSchemaDb();

    // Seed data before migration
    db.exec("INSERT INTO workspaces (name) VALUES ('ws')");
    const { id: wsId } = db.prepare("SELECT id FROM workspaces WHERE name = 'ws'").get() as { id: number };
    db.exec(`INSERT INTO features (workspace_id, name) VALUES (${wsId}, 'ft')`);
    const { id: ftId } = db.prepare("SELECT id FROM features WHERE name = 'ft'").get() as { id: number };
    db.exec(`INSERT INTO contents (feature_id, type, body) VALUES (${ftId}, 'idea', 'existing body')`);

    applySchema(db);

    const rows = db.prepare("SELECT * FROM contents").all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe("existing body");
    expect(rows[0].type).toBe("idea");
    expect("title" in rows[0]).toBe(true);
    expect(rows[0].title).toBeNull();
  });

  it("migration is idempotent — running applySchema twice is safe", () => {
    const db = createOldSchemaDb();
    db.exec("INSERT INTO workspaces (name) VALUES ('ws')");
    const { id: wsId } = db.prepare("SELECT id FROM workspaces WHERE name = 'ws'").get() as { id: number };
    db.exec(`INSERT INTO features (workspace_id, name) VALUES (${wsId}, 'ft')`);
    const { id: ftId } = db.prepare("SELECT id FROM features WHERE name = 'ft'").get() as { id: number };
    db.exec(`INSERT INTO contents (feature_id, type, body) VALUES (${ftId}, 'idea', 'body')`);

    applySchema(db);
    applySchema(db); // second call must not throw or corrupt data

    const rows = db.prepare("SELECT * FROM contents").all();
    expect(rows).toHaveLength(1);
  });

  it("after migration, doc type can be inserted", () => {
    const db = createOldSchemaDb();
    db.exec("INSERT INTO workspaces (name) VALUES ('ws')");
    const { id: wsId } = db.prepare("SELECT id FROM workspaces WHERE name = 'ws'").get() as { id: number };
    db.exec(`INSERT INTO features (workspace_id, name) VALUES (${wsId}, 'ft')`);
    const { id: ftId } = db.prepare("SELECT id FROM features WHERE name = 'ft'").get() as { id: number };

    applySchema(db);

    expect(() =>
      db.exec(`INSERT INTO contents (feature_id, type, body) VALUES (${ftId}, 'doc', 'doc body')`)
    ).not.toThrow();
  });

  it("FTS still works after migration", () => {
    const db = createOldSchemaDb();
    db.exec("INSERT INTO workspaces (name) VALUES ('ws')");
    const { id: wsId } = db.prepare("SELECT id FROM workspaces WHERE name = 'ws'").get() as { id: number };
    db.exec(`INSERT INTO features (workspace_id, name) VALUES (${wsId}, 'ft')`);
    const { id: ftId } = db.prepare("SELECT id FROM features WHERE name = 'ft'").get() as { id: number };
    db.exec(`INSERT INTO contents (feature_id, type, body) VALUES (${ftId}, 'idea', 'preflight keyword')`);

    applySchema(db);

    // Existing row should be findable via FTS after rebuild
    const matches = db.prepare("SELECT rowid FROM contents_fts WHERE contents_fts MATCH 'preflight'").all();
    expect(matches).toHaveLength(1);

    // New inserts should also be indexed
    db.exec(`INSERT INTO contents (feature_id, type, body) VALUES (${ftId}, 'doc', 'postmigration keyword')`);
    const newMatches = db.prepare("SELECT rowid FROM contents_fts WHERE contents_fts MATCH 'postmigration'").all();
    expect(newMatches).toHaveLength(1);
  });
});
