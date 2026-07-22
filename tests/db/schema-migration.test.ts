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

describe("migration 3: embedding column + vec_contents", () => {
  it("adds embedding column to existing DB", () => {
    const db = createOldSchemaDb();
    applySchema(db);

    const cols = db.prepare("SELECT name FROM pragma_table_info('contents')").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("embedding");
  });

  it("creates vec_contents virtual table", () => {
    const db = createOldSchemaDb();
    applySchema(db);

    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vec_contents'")
      .get() as { name: string } | undefined;
    expect(table?.name).toBe("vec_contents");
  });

  it("INSERT trigger populates vec_contents when embedding is provided", () => {
    const db = createOldSchemaDb();
    applySchema(db);

    db.exec("INSERT INTO workspaces (name) VALUES ('ws')");
    const { id: wsId } = db.prepare("SELECT id FROM workspaces WHERE name = 'ws'").get() as { id: number };
    db.exec(`INSERT INTO features (workspace_id, name) VALUES (${wsId}, 'ft')`);
    const { id: ftId } = db.prepare("SELECT id FROM features WHERE name = 'ft'").get() as { id: number };

    const fakeVec = Buffer.alloc(384 * 4, 0);
    db.prepare("INSERT INTO contents (feature_id, type, body, embedding) VALUES (?, 'idea', 'hello', ?)").run(ftId, fakeVec);
    const { id: contentId } = db.prepare("SELECT id FROM contents WHERE body = 'hello'").get() as { id: number };

    const row = db.prepare("SELECT rowid FROM vec_contents WHERE rowid = ?").get(contentId);
    expect(row).toBeTruthy();
  });

  it("DELETE trigger removes from vec_contents", () => {
    const db = createOldSchemaDb();
    applySchema(db);

    db.exec("INSERT INTO workspaces (name) VALUES ('ws')");
    const { id: wsId } = db.prepare("SELECT id FROM workspaces WHERE name = 'ws'").get() as { id: number };
    db.exec(`INSERT INTO features (workspace_id, name) VALUES (${wsId}, 'ft')`);
    const { id: ftId } = db.prepare("SELECT id FROM features WHERE name = 'ft'").get() as { id: number };

    const fakeVec = Buffer.alloc(384 * 4, 0);
    db.prepare("INSERT INTO contents (feature_id, type, body, embedding) VALUES (?, 'idea', 'to-delete', ?)").run(ftId, fakeVec);
    const { id: contentId } = db.prepare("SELECT id FROM contents WHERE body = 'to-delete'").get() as { id: number };
    db.prepare("DELETE FROM contents WHERE id = ?").run(contentId);

    const row = db.prepare("SELECT rowid FROM vec_contents WHERE rowid = ?").get(contentId);
    expect(row).toBeUndefined();
  });

  it("migration is idempotent for embedding column and vec_contents", () => {
    const db = createOldSchemaDb();
    applySchema(db);
    expect(() => applySchema(db)).not.toThrow();
  });
});

describe("migration 4: content_links table", () => {
  it("creates content_links table", () => {
    const db = createOldSchemaDb();
    applySchema(db);

    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_links'")
      .get() as { name: string } | undefined;
    expect(table?.name).toBe("content_links");
  });

  it("creates idx_content_links_child index", () => {
    const db = createOldSchemaDb();
    applySchema(db);

    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_content_links_child'")
      .get() as { name: string } | undefined;
    expect(idx?.name).toBe("idx_content_links_child");
  });

  it("migration 4 is idempotent", () => {
    const db = createOldSchemaDb();
    applySchema(db);
    expect(() => applySchema(db)).not.toThrow();
  });

  it("CASCADE delete: removing a content deletes its links", () => {
    const db = createOldSchemaDb();
    applySchema(db);

    db.exec("INSERT INTO workspaces (name) VALUES ('ws')");
    const { id: wsId } = db.prepare("SELECT id FROM workspaces WHERE name = 'ws'").get() as { id: number };
    db.exec(`INSERT INTO features (workspace_id, name) VALUES (${wsId}, 'ft')`);
    const { id: ftId } = db.prepare("SELECT id FROM features WHERE name = 'ft'").get() as { id: number };

    db.prepare("INSERT INTO contents (feature_id, type, body) VALUES (?, 'idea', 'parent')").run(ftId);
    const parent = db.prepare("SELECT id FROM contents WHERE body = 'parent'").get() as { id: number };
    db.prepare("INSERT INTO contents (feature_id, type, body) VALUES (?, 'spec', 'child')").run(ftId);
    const child = db.prepare("SELECT id FROM contents WHERE body = 'child'").get() as { id: number };

    db.prepare("INSERT INTO content_links (parent_id, child_id) VALUES (?, ?)").run(parent.id, child.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM content_links").get() as { n: number }).toEqual({ n: 1 });

    db.prepare("DELETE FROM contents WHERE id = ?").run(parent.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM content_links").get() as { n: number }).toEqual({ n: 0 });
  });

  it("composite PK prevents duplicate links", () => {
    const db = createOldSchemaDb();
    applySchema(db);

    db.exec("INSERT INTO workspaces (name) VALUES ('ws')");
    const { id: wsId } = db.prepare("SELECT id FROM workspaces WHERE name = 'ws'").get() as { id: number };
    db.exec(`INSERT INTO features (workspace_id, name) VALUES (${wsId}, 'ft')`);
    const { id: ftId } = db.prepare("SELECT id FROM features WHERE name = 'ft'").get() as { id: number };

    db.prepare("INSERT INTO contents (feature_id, type, body) VALUES (?, 'idea', 'p')").run(ftId);
    const p = db.prepare("SELECT id FROM contents WHERE body = 'p'").get() as { id: number };
    db.prepare("INSERT INTO contents (feature_id, type, body) VALUES (?, 'spec', 'c')").run(ftId);
    const c = db.prepare("SELECT id FROM contents WHERE body = 'c'").get() as { id: number };

    db.prepare("INSERT INTO content_links (parent_id, child_id) VALUES (?, ?)").run(p.id, c.id);
    db.prepare("INSERT OR IGNORE INTO content_links (parent_id, child_id) VALUES (?, ?)").run(p.id, c.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM content_links").get() as { n: number }).toEqual({ n: 1 });
  });
});

describe("migration 7: reviews and review_comments tables", () => {
  it("creates reviews table", () => {
    const db = createOldSchemaDb();
    applySchema(db);

    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reviews'")
      .get() as { name: string } | undefined;
    expect(table?.name).toBe("reviews");
  });

  it("creates review_comments table", () => {
    const db = createOldSchemaDb();
    applySchema(db);

    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'review_comments'")
      .get() as { name: string } | undefined;
    expect(table?.name).toBe("review_comments");
  });

  it("migration 7 is idempotent", () => {
    const db = createOldSchemaDb();
    applySchema(db);
    expect(() => applySchema(db)).not.toThrow();
  });

  it("CASCADE delete: removing a content deletes its reviews and comments", () => {
    const db = createOldSchemaDb();
    applySchema(db);

    db.exec("INSERT INTO workspaces (name) VALUES ('ws')");
    const { id: wsId } = db.prepare("SELECT id FROM workspaces WHERE name = 'ws'").get() as { id: number };
    db.exec(`INSERT INTO features (workspace_id, name) VALUES (${wsId}, 'ft')`);
    const { id: ftId } = db.prepare("SELECT id FROM features WHERE name = 'ft'").get() as { id: number };
    db.prepare("INSERT INTO contents (feature_id, type, body) VALUES (?, 'spec', 'body')").run(ftId);
    const { id: contentId } = db.prepare("SELECT id FROM contents WHERE body = 'body'").get() as { id: number };

    db.prepare("INSERT INTO reviews (content_id) VALUES (?)").run(contentId);
    const { id: reviewId } = db.prepare("SELECT id FROM reviews WHERE content_id = ?").get(contentId) as { id: number };
    db.prepare("INSERT INTO review_comments (review_id, comment) VALUES (?, ?)").run(reviewId, "test comment");

    db.prepare("DELETE FROM contents WHERE id = ?").run(contentId);
    expect(db.prepare("SELECT COUNT(*) AS n FROM reviews").get() as { n: number }).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM review_comments").get() as { n: number }).toEqual({ n: 0 });
  });

  it("reviews default status is pending", () => {
    const db = createOldSchemaDb();
    applySchema(db);

    db.exec("INSERT INTO workspaces (name) VALUES ('ws')");
    const { id: wsId } = db.prepare("SELECT id FROM workspaces WHERE name = 'ws'").get() as { id: number };
    db.exec(`INSERT INTO features (workspace_id, name) VALUES (${wsId}, 'ft')`);
    const { id: ftId } = db.prepare("SELECT id FROM features WHERE name = 'ft'").get() as { id: number };
    db.prepare("INSERT INTO contents (feature_id, type, body) VALUES (?, 'spec', 'body')").run(ftId);
    const { id: contentId } = db.prepare("SELECT id FROM contents WHERE body = 'body'").get() as { id: number };

    db.prepare("INSERT INTO reviews (content_id) VALUES (?)").run(contentId);
    const row = db.prepare("SELECT status FROM reviews WHERE content_id = ?").get(contentId) as { status: string };
    expect(row.status).toBe("pending");
  });
});
