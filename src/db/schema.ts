import type Database from "better-sqlite3";

const VEC_TABLE_AND_TRIGGERS = `
  CREATE VIRTUAL TABLE IF NOT EXISTS vec_contents USING vec0(
    embedding float[384]
  );

  CREATE TRIGGER IF NOT EXISTS contents_vec_ai AFTER INSERT ON contents
  WHEN new.embedding IS NOT NULL BEGIN
    INSERT INTO vec_contents(rowid, embedding) VALUES (new.id, new.embedding);
  END;

  CREATE TRIGGER IF NOT EXISTS contents_vec_au AFTER UPDATE ON contents
  WHEN new.embedding IS NOT NULL BEGIN
    DELETE FROM vec_contents WHERE rowid = old.id;
    INSERT INTO vec_contents(rowid, embedding) VALUES (new.id, new.embedding);
  END;

  CREATE TRIGGER IF NOT EXISTS contents_vec_ad AFTER DELETE ON contents BEGIN
    DELETE FROM vec_contents WHERE rowid = old.id;
  END;
`;

const FTS_AND_TRIGGERS = `
  CREATE VIRTUAL TABLE IF NOT EXISTS contents_fts USING fts5(
    body,
    content=contents,
    content_rowid=id,
    tokenize='unicode61'
  );

  CREATE TRIGGER IF NOT EXISTS contents_ai AFTER INSERT ON contents BEGIN
    INSERT INTO contents_fts(rowid, body) VALUES (new.id, new.body);
  END;

  CREATE TRIGGER IF NOT EXISTS contents_ad AFTER DELETE ON contents BEGIN
    INSERT INTO contents_fts(contents_fts, rowid, body) VALUES ('delete', old.id, old.body);
  END;

  CREATE TRIGGER IF NOT EXISTS contents_au AFTER UPDATE ON contents BEGIN
    INSERT INTO contents_fts(contents_fts, rowid, body) VALUES ('delete', old.id, old.body);
    INSERT INTO contents_fts(rowid, body) VALUES (new.id, new.body);
  END;
`;

export function applySchema(db: Database.Database): void {
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id   INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS features (
      id           INTEGER PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      UNIQUE(workspace_id, name)
    );

    CREATE TABLE IF NOT EXISTS contents (
      id         INTEGER PRIMARY KEY,
      feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      title      TEXT,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_feature_digest
      ON contents(feature_id) WHERE type = 'digest';
  `);

  db.exec(FTS_AND_TRIGGERS);

  runMigrations(db);

  // Vec table and triggers created after all migrations so DROP TABLE in migration 2
  // does not silently remove them.
  db.exec(VEC_TABLE_AND_TRIGGERS);

  db.exec(`
    CREATE TABLE IF NOT EXISTS error_logs (
      id        INTEGER PRIMARY KEY,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      tool_name TEXT NOT NULL,
      message   TEXT NOT NULL,
      severity  TEXT NOT NULL DEFAULT 'error'
    );
  `);
}

function runMigrations(db: Database.Database): void {
  // Migration 1: add title column if missing (existing DBs pre-dating this change)
  const hasTitle = (
    db
      .prepare("SELECT COUNT(*) AS cnt FROM pragma_table_info('contents') WHERE name = 'title'")
      .get() as { cnt: number }
  ).cnt > 0;

  if (!hasTitle) {
    db.exec("ALTER TABLE contents ADD COLUMN title TEXT");
  }

  // Migration 2: remove CHECK constraint on type (required to support new types without table recreation)
  const { sql: tableSQL } = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'contents'")
    .get() as { sql: string };

  if (tableSQL.includes("CHECK")) {
    removeCheckConstraint(db);
  }

  // Migration 3: add embedding column for vector search
  const hasEmbedding = (
    db
      .prepare("SELECT COUNT(*) AS cnt FROM pragma_table_info('contents') WHERE name = 'embedding'")
      .get() as { cnt: number }
  ).cnt > 0;

  if (!hasEmbedding) {
    db.exec("ALTER TABLE contents ADD COLUMN embedding BLOB");
  }
}

function removeCheckConstraint(db: Database.Database): void {
  // SQLite cannot ALTER TABLE to modify a CHECK constraint — requires full table recreation.
  // foreign_keys must be off during the swap; PRAGMA cannot change inside a transaction.
  db.exec("PRAGMA foreign_keys = OFF");

  db.exec(`
    BEGIN;

    DROP TRIGGER IF EXISTS contents_ai;
    DROP TRIGGER IF EXISTS contents_ad;
    DROP TRIGGER IF EXISTS contents_au;
    DROP TABLE IF EXISTS contents_fts;

    CREATE TABLE contents_new (
      id         INTEGER PRIMARY KEY,
      feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      title      TEXT,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO contents_new (id, feature_id, type, title, body, created_at, updated_at)
      SELECT id, feature_id, type, title, body, created_at, updated_at FROM contents;

    DROP TABLE contents;
    ALTER TABLE contents_new RENAME TO contents;

    CREATE UNIQUE INDEX uq_feature_digest ON contents(feature_id) WHERE type = 'digest';

    COMMIT;
  `);

  // FTS virtual table and triggers must be created outside the transaction above.
  db.exec(FTS_AND_TRIGGERS.replace(/IF NOT EXISTS /g, ""));
  db.exec("INSERT INTO contents_fts(contents_fts) VALUES ('rebuild')");

  db.exec("PRAGMA foreign_keys = ON");
}
