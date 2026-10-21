import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { applySchema } from "../../src/db/schema.js";
import { createTestDb } from "../setup.js";

/** DB at migrations 1-18 but with the old INTEGER PRIMARY KEY on contents. */
function buildPre19Db(): Database.Database {
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
      id             INTEGER NOT NULL PRIMARY KEY,
      type           TEXT    NOT NULL DEFAULT '',
      title          TEXT,
      body           TEXT    NOT NULL DEFAULT '',
      embedding      BLOB,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      root_id        INTEGER,
      version_number INTEGER NOT NULL DEFAULT 1,
      is_latest      INTEGER NOT NULL DEFAULT 1,
      created_by     TEXT,
      updated_by     TEXT,
      source_key     TEXT,
      source_sha     TEXT
    );
    CREATE TABLE content_features (
      content_id INTEGER NOT NULL DEFAULT 0,
      feature_id INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (content_id, feature_id)
    );
    CREATE TABLE content_links (
      parent_id  INTEGER NOT NULL DEFAULT 0,
      child_id   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (parent_id, child_id)
    );
    CREATE TABLE code_refs (
      id          INTEGER PRIMARY KEY,
      content_id  INTEGER NOT NULL DEFAULT 0,
      task_ref    TEXT,
      commit_hash TEXT    NOT NULL DEFAULT '',
      file_paths  TEXT    NOT NULL DEFAULT '[]',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(content_id, commit_hash)
    );
    CREATE TABLE reviews (
      id           INTEGER PRIMARY KEY,
      content_id   INTEGER NOT NULL DEFAULT 0,
      status       TEXT    NOT NULL DEFAULT 'pending',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      committed_at TEXT
    );
    CREATE TABLE review_comments (
      id            INTEGER PRIMARY KEY,
      review_id     INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      selected_text TEXT,
      comment       TEXT    NOT NULL DEFAULT '',
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      resolved_at   TEXT
    );
    CREATE TABLE content_chunks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id    INTEGER NOT NULL DEFAULT 0,
      kind          TEXT    NOT NULL DEFAULT '',
      chunk_key     TEXT    NOT NULL DEFAULT '',
      ord           INTEGER NOT NULL DEFAULT 0,
      heading_path  TEXT    NOT NULL DEFAULT '',
      start_char    INTEGER,
      end_char      INTEGER,
      start_line    INTEGER NOT NULL DEFAULT 0,
      end_line      INTEGER NOT NULL DEFAULT 0,
      source_path   TEXT,
      source_commit TEXT,
      chunk_sha     TEXT    NOT NULL DEFAULT '',
      embedding     BLOB,
      UNIQUE(content_id, kind, chunk_key)
    );
    CREATE TABLE workspace_team (
      workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('host', 'peer')),
      secret TEXT NOT NULL, noise_public_key TEXT NOT NULL,
      noise_secret_key TEXT NOT NULL, host_public_key TEXT, last_synced_at TEXT
    );
    CREATE TABLE workspace_invites (
      id INTEGER PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      github_username TEXT NOT NULL,
      invited_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(workspace_id, github_username)
    );
    CREATE TABLE team_peers (
      id INTEGER PRIMARY KEY NOT NULL, public_key TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')), github_username TEXT
    );
    CREATE TABLE error_logs (
      id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      tool_name TEXT NOT NULL, message TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'error'
    );
    CREATE VIRTUAL TABLE vec_contents USING vec0(embedding float[384]);
    CREATE VIRTUAL TABLE vec_chunks   USING vec0(embedding float[384]);
    CREATE VIRTUAL TABLE sot_chunks_fts USING fts5(
      heading, body, content='', contentless_delete=1, tokenize='unicode61'
    );
    CREATE INDEX idx_content_features_feature     ON content_features(feature_id);
    CREATE INDEX idx_content_links_child           ON content_links(child_id);
    CREATE INDEX idx_code_refs_content             ON code_refs(content_id);
    CREATE INDEX idx_reviews_content               ON reviews(content_id);
    CREATE INDEX idx_content_chunks_content        ON content_chunks(content_id);
    CREATE INDEX idx_contents_root_id              ON contents(root_id);
    CREATE INDEX idx_contents_created_at           ON contents(created_at) WHERE is_latest = 1;
    CREATE INDEX idx_contents_type_created_at      ON contents(type, created_at) WHERE is_latest = 1;
    CREATE UNIQUE INDEX idx_contents_source_key    ON contents(source_key) WHERE source_key IS NOT NULL;
  `);
  return db;
}

const n = (db: Database.Database, t: string) =>
  (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
const sqlOf = (db: Database.Database, name: string) =>
  (db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name) as { sql: string } | undefined)?.sql ?? "";
const idType = (db: Database.Database) =>
  (db.prepare("SELECT type FROM pragma_table_info('contents') WHERE name = 'id'").get() as { type: string }).type;

describe("Migration 19 — contents.id INTEGER → TEXT UUID", () => {
  it("fresh DB: contents.id column type is TEXT", () => {
    const db = createTestDb();
    expect(idType(db)).toBe("TEXT");
  });

  it("pre-19 DB: contents.id is promoted to TEXT after applySchema", () => {
    const db = buildPre19Db();
    expect(idType(db)).toBe("INTEGER");
    applySchema(db);
    expect(idType(db)).toBe("TEXT");
  });

  it("body and title are preserved after migration", () => {
    const db = buildPre19Db();
    db.prepare("INSERT INTO contents (id, type, title, body) VALUES (1, 'idea', 'My Idea', 'hello world')").run();
    applySchema(db);
    const row = db.prepare("SELECT title, body FROM contents").get() as { title: string; body: string };
    expect(row.title).toBe("My Idea");
    expect(row.body).toBe("hello world");
  });

  it("id is a 32-hex UUID after migration", () => {
    const db = buildPre19Db();
    db.prepare("INSERT INTO contents (id, type, body) VALUES (42, 'spec', 'some spec')").run();
    applySchema(db);
    const row = db.prepare("SELECT id FROM contents").get() as { id: string };
    expect(row.id).toMatch(/^[0-9a-f]{32}$/);
    expect(row.id).not.toBe("42");
  });

  it("root_id self-reference is remapped to the new UUID", () => {
    const db = buildPre19Db();
    db.prepare("INSERT INTO contents (id, type, body, version_number) VALUES (1, 'plan', 'v1', 1)").run();
    db.prepare("INSERT INTO contents (id, type, body, root_id, version_number) VALUES (2, 'plan', 'v2', 1, 2)").run();
    applySchema(db);

    const rows = db.prepare("SELECT id, root_id FROM contents ORDER BY version_number").all() as
      Array<{ id: string; root_id: string | null }>;
    expect(rows[0].root_id).toBeNull();
    expect(rows[1].root_id).toBe(rows[0].id);
  });

  it("content_features.content_id becomes the new TEXT UUID", () => {
    const db = buildPre19Db();
    db.prepare("INSERT INTO workspaces (id, name) VALUES (1, 'ws')").run();
    db.prepare("INSERT INTO features (id, workspace_id, name) VALUES (1, 1, 'feat')").run();
    db.prepare("INSERT INTO contents (id, type, body) VALUES (3, 'idea', 'feat doc')").run();
    db.prepare("INSERT INTO content_features (content_id, feature_id) VALUES (3, 1)").run();
    applySchema(db);

    const cf = db.prepare("SELECT content_id FROM content_features").get() as { content_id: string };
    const c  = db.prepare("SELECT id FROM contents").get() as { id: string };
    expect(cf.content_id).toBe(c.id);
    expect(cf.content_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("content_links parent_id and child_id are remapped to UUIDs", () => {
    const db = buildPre19Db();
    db.prepare("INSERT INTO contents (id, type, body) VALUES (1, 'idea', 'parent')").run();
    db.prepare("INSERT INTO contents (id, type, body) VALUES (2, 'spec', 'child')").run();
    db.prepare("INSERT INTO content_links (parent_id, child_id) VALUES (1, 2)").run();
    applySchema(db);

    const ids = db.prepare("SELECT id FROM contents ORDER BY rowid").all() as Array<{ id: string }>;
    const link = db.prepare("SELECT parent_id, child_id FROM content_links").get() as
      { parent_id: string; child_id: string };
    expect(link.parent_id).toBe(ids[0].id);
    expect(link.child_id).toBe(ids[1].id);
  });

  it("code_refs.content_id is remapped to the new UUID", () => {
    const db = buildPre19Db();
    db.prepare("INSERT INTO contents (id, type, body) VALUES (5, 'plan', 'plan body')").run();
    db.prepare("INSERT INTO code_refs (content_id, commit_hash, file_paths) VALUES (5, 'abc123', '[]')").run();
    applySchema(db);

    const ref = db.prepare("SELECT content_id FROM code_refs").get() as { content_id: string };
    const c   = db.prepare("SELECT id FROM contents").get() as { id: string };
    expect(ref.content_id).toBe(c.id);
  });

  it("reviews.content_id is remapped to the new UUID", () => {
    const db = buildPre19Db();
    db.prepare("INSERT INTO contents (id, type, body) VALUES (7, 'doc', 'the doc')").run();
    db.prepare("INSERT INTO reviews (content_id, status) VALUES (7, 'pending')").run();
    applySchema(db);

    const rv = db.prepare("SELECT content_id FROM reviews").get() as { content_id: string };
    const c  = db.prepare("SELECT id FROM contents").get() as { id: string };
    expect(rv.content_id).toBe(c.id);
  });

  it("content_chunks.content_id is remapped to the new UUID", () => {
    const db = buildPre19Db();
    db.prepare("INSERT INTO contents (id, type, body) VALUES (9, 'doc', 'chunked doc')").run();
    db.prepare(
      "INSERT INTO content_chunks (content_id, kind, chunk_key, ord, heading_path, start_line, end_line, chunk_sha) VALUES (9, 'sot', 'k1', 0, '', 1, 10, 'sha1')"
    ).run();
    applySchema(db);

    const cc = db.prepare("SELECT content_id FROM content_chunks").get() as { content_id: string };
    const c  = db.prepare("SELECT id FROM contents").get() as { id: string };
    expect(cc.content_id).toBe(c.id);
  });

  it("FTS triggers use rowid after migration: insert/update/delete are reflected", () => {
    const db = buildPre19Db();
    db.prepare("INSERT INTO contents (id, type, body) VALUES (1, 'idea', 'searchable text')").run();
    applySchema(db);

    expect(n(db, "contents_fts")).toBe(1);
    // FTS rowid matches contents rowid
    const ftsRow = db.prepare("SELECT rowid FROM contents_fts WHERE contents_fts MATCH 'searchable'").get() as
      { rowid: number } | undefined;
    const cRow = db.prepare("SELECT rowid FROM contents").get() as { rowid: number };
    expect(ftsRow?.rowid).toBe(cRow.rowid);

    // Trigger: update
    db.prepare("UPDATE contents SET body = 'updated text'").run();
    expect(db.prepare("SELECT rowid FROM contents_fts WHERE contents_fts MATCH 'searchable'").get()).toBeUndefined();
    expect(db.prepare("SELECT rowid FROM contents_fts WHERE contents_fts MATCH 'updated'").get()).toBeDefined();

    // Trigger: delete
    db.prepare("DELETE FROM contents").run();
    expect(n(db, "contents_fts")).toBe(0);
  });

  it("vec_contents rowid equals contents.rowid (not a UUID integer)", () => {
    const db = buildPre19Db();
    db.prepare("INSERT INTO contents (id, type, body) VALUES (1, 'idea', 'vec test')").run();
    applySchema(db);

    const embedding = Buffer.from(new Float32Array(384).fill(0.1).buffer);
    db.prepare("UPDATE contents SET embedding = ?").run(embedding);

    const vecRow = db.prepare("SELECT rowid FROM vec_contents").get() as { rowid: number } | undefined;
    const cRow   = db.prepare("SELECT rowid FROM contents").get() as { rowid: number };
    expect(vecRow?.rowid).toBe(cRow.rowid);
    // rowid is a small integer, not a UUID parsed as integer
    expect(vecRow?.rowid).toBeLessThan(1_000_000);
  });

  it("new rows inserted after migration get UUID ids", () => {
    const db = createTestDb();
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO contents (type, body) VALUES ('idea', 'new content')"
    ).run();

    const row = db.prepare("SELECT id FROM contents WHERE rowid = ?").get(lastInsertRowid) as { id: string };
    expect(row.id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("vec_contents trigger works for new inserts after migration", () => {
    const db = createTestDb();
    const embedding = Buffer.from(new Float32Array(384).fill(0.5).buffer);
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO contents (type, body, embedding) VALUES ('idea', 'vec insert', ?)"
    ).run(embedding);

    const cRow   = db.prepare("SELECT rowid FROM contents WHERE rowid = ?").get(lastInsertRowid) as { rowid: number };
    const vecRow = db.prepare("SELECT rowid FROM vec_contents").get() as { rowid: number } | undefined;
    expect(vecRow?.rowid).toBe(cRow.rowid);
  });

  it("is idempotent: running applySchema twice preserves ids and counts", () => {
    const db = buildPre19Db();
    db.prepare("INSERT INTO contents (id, type, body) VALUES (1, 'idea', 'stable')").run();
    applySchema(db);

    const idFirst = (db.prepare("SELECT id FROM contents").get() as { id: string }).id;
    applySchema(db);
    const idSecond = (db.prepare("SELECT id FROM contents").get() as { id: string }).id;

    expect(idFirst).toBe(idSecond);
    expect(n(db, "contents")).toBe(1);
    expect(n(db, "contents_fts")).toBe(1);
  });

  it("triggers sql uses rowid (not id) after migration", () => {
    const db = createTestDb();
    expect(sqlOf(db, "contents_ai")).toContain("new.rowid");
    expect(sqlOf(db, "contents_ai")).not.toContain("new.id");
    expect(sqlOf(db, "contents_vec_ai")).toContain("new.rowid");
    expect(sqlOf(db, "contents_vec_ai")).not.toContain("new.id");
  });
});
