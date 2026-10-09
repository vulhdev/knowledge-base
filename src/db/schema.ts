import type Database from "better-sqlite3";
import { bigramIndexText } from "../text/cjk-bigram.js";

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

  CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
    embedding float[384]
  );

  CREATE TRIGGER IF NOT EXISTS content_chunks_vec_ai AFTER INSERT ON content_chunks
  WHEN new.embedding IS NOT NULL BEGIN
    INSERT INTO vec_chunks(rowid, embedding) VALUES (new.id, new.embedding);
  END;

  CREATE TRIGGER IF NOT EXISTS content_chunks_vec_au AFTER UPDATE ON content_chunks
  WHEN new.embedding IS NOT NULL BEGIN
    DELETE FROM vec_chunks WHERE rowid = old.id;
    INSERT INTO vec_chunks(rowid, embedding) VALUES (new.id, new.embedding);
  END;

  CREATE TRIGGER IF NOT EXISTS content_chunks_ad AFTER DELETE ON content_chunks BEGIN
    DELETE FROM vec_chunks WHERE rowid = old.id;
    DELETE FROM sot_chunks_fts WHERE rowid = old.id AND old.kind = 'sot';
  END;
`;

const FTS_AND_TRIGGERS = `
  CREATE VIRTUAL TABLE IF NOT EXISTS contents_fts USING fts5(
    title,
    body,
    content='',
    contentless_delete=1,
    tokenize='unicode61'
  );

  CREATE TRIGGER IF NOT EXISTS contents_ai AFTER INSERT ON contents BEGIN
    INSERT INTO contents_fts(rowid, title, body) VALUES (new.id, kb_cjk_bigram(new.title), kb_cjk_bigram(new.body));
  END;

  CREATE TRIGGER IF NOT EXISTS contents_ad AFTER DELETE ON contents BEGIN
    DELETE FROM contents_fts WHERE rowid = old.id;
  END;

  CREATE TRIGGER IF NOT EXISTS contents_au AFTER UPDATE ON contents BEGIN
    DELETE FROM contents_fts WHERE rowid = old.id;
    INSERT INTO contents_fts(rowid, title, body) VALUES (new.id, kb_cjk_bigram(new.title), kb_cjk_bigram(new.body));
  END;
`;

// Contentless FTS cannot 'rebuild' from contents — refill it through the same bigram function the triggers use.
function repopulateContentsFts(db: Database.Database): void {
  db.exec(`
    DELETE FROM contents_fts;
    INSERT INTO contents_fts(rowid, title, body)
      SELECT id, kb_cjk_bigram(title), kb_cjk_bigram(body) FROM contents;
  `);
}

// One transaction: a crash mid-way rolls back to the old table and triggers, which the
// Migration 6/11 detection then still sees as "not migrated" and re-runs.
function recreateContentsFts(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      DROP TRIGGER IF EXISTS contents_ai;
      DROP TRIGGER IF EXISTS contents_ad;
      DROP TRIGGER IF EXISTS contents_au;
      DROP TABLE IF EXISTS contents_fts;
    `);
    db.exec(FTS_AND_TRIGGERS);
    repopulateContentsFts(db);
  })();
}

export function applySchema(db: Database.Database): void {
  // Must be registered before any statement that can fire the contents_fts triggers.
  db.function("kb_cjk_bigram", { deterministic: true }, (text: unknown) =>
    text === null || text === undefined ? null : bigramIndexText(String(text)),
  );
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
      type       TEXT NOT NULL,
      title      TEXT,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS content_features (
      content_id INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
      feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      PRIMARY KEY (content_id, feature_id)
    );

    CREATE INDEX IF NOT EXISTS idx_content_features_feature
      ON content_features(feature_id);
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

  // Migration 4: add content_links table for provenance tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_links (
      parent_id  INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
      child_id   INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (parent_id, child_id)
    );

    CREATE INDEX IF NOT EXISTS idx_content_links_child ON content_links(child_id);
  `);

  // Migration 5: add code_refs table for linking plans to git commits
  db.exec(`
    CREATE TABLE IF NOT EXISTS code_refs (
      id          INTEGER PRIMARY KEY,
      content_id  INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
      task_ref    TEXT,
      commit_hash TEXT NOT NULL,
      file_paths  TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(content_id, commit_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_code_refs_content ON code_refs(content_id);
  `);

  // Migration 7: reviews and review_comments tables for GUI inline commenting
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id           INTEGER PRIMARY KEY,
      content_id   INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      committed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_content ON reviews(content_id);

    CREATE TABLE IF NOT EXISTS review_comments (
      id            INTEGER PRIMARY KEY,
      review_id     INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      selected_text TEXT,
      comment       TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration 8: add resolved_at to review_comments for per-comment resolution tracking
  const hasResolvedAt = (
    db.prepare("SELECT name FROM pragma_table_info('review_comments') WHERE name = 'resolved_at'").get()
  );
  if (!hasResolvedAt) {
    db.exec(`ALTER TABLE review_comments ADD COLUMN resolved_at TEXT`);
  }

  // Migration 9: replace feature_id with content_features junction table
  const hasFeatureId = (
    db
      .prepare("SELECT COUNT(*) AS cnt FROM pragma_table_info('contents') WHERE name = 'feature_id'")
      .get() as { cnt: number }
  ).cnt > 0;

  if (hasFeatureId) {
    removeFeatureIdColumn(db);
  }

  // Migration 6: FTS indexes title column so title matches get BM25 boost
  const ftsSql = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'contents_fts'")
      .get() as { sql: string } | undefined
  )?.sql ?? "";

  if (!ftsSql.includes("title")) {
    recreateContentsFts(db);
  }

  // Migration 10: index contents(created_at) and contents(type, created_at) for list ordering
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_contents_created_at ON contents(created_at);
    CREATE INDEX IF NOT EXISTS idx_contents_type_created_at ON contents(type, created_at);
  `);

  // Migration 11: contents_fts becomes contentless and indexes CJK as bigrams (kb_cjk_bigram)
  const fts11 = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'contents_fts'")
      .get() as { sql: string } | undefined
  )?.sql ?? "";
  const trigger11 = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'contents_ai'")
      .get() as { sql: string } | undefined
  )?.sql ?? "";

  if (!fts11.includes("contentless_delete") || !trigger11.includes("kb_cjk_bigram")) {
    recreateContentsFts(db);
  }

  // Migration 12: section rows (offset-only, no text) for docs and SOT pointers, plus the
  // contentless FTS that holds SOT section tokens. vec_chunks and its triggers live in the VEC block.
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_chunks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT, -- never reuse ids: they key vec_chunks and sot_chunks_fts
      content_id    INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
      kind          TEXT NOT NULL,
      chunk_key     TEXT NOT NULL,
      ord           INTEGER NOT NULL,
      heading_path  TEXT NOT NULL,
      start_char    INTEGER,
      end_char      INTEGER,
      start_line    INTEGER NOT NULL,
      end_line      INTEGER NOT NULL,
      source_path   TEXT,
      source_commit TEXT,
      chunk_sha     TEXT NOT NULL,
      embedding     BLOB,
      UNIQUE(content_id, kind, chunk_key)
    );

    CREATE INDEX IF NOT EXISTS idx_content_chunks_content ON content_chunks(content_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS sot_chunks_fts USING fts5(
      heading, body, content='', contentless_delete=1, tokenize='unicode61'
    );
  `);

  // Migration 13: provenance of imported rows — source_key (unique when set) and source_sha
  const hasSourceKey = (
    db
      .prepare("SELECT COUNT(*) AS cnt FROM pragma_table_info('contents') WHERE name = 'source_key'")
      .get() as { cnt: number }
  ).cnt > 0;
  if (!hasSourceKey) {
    db.exec("ALTER TABLE contents ADD COLUMN source_key TEXT");
  }
  const hasSourceSha = (
    db
      .prepare("SELECT COUNT(*) AS cnt FROM pragma_table_info('contents') WHERE name = 'source_sha'")
      .get() as { cnt: number }
  ).cnt > 0;
  if (!hasSourceSha) {
    db.exec("ALTER TABLE contents ADD COLUMN source_sha TEXT");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_contents_source_key ON contents(source_key) WHERE source_key IS NOT NULL");
}

function removeFeatureIdColumn(db: Database.Database): void {
  // SQLite cannot DROP COLUMN with FK dependencies — requires full table recreation.
  // foreign_keys must be off during the swap; PRAGMA cannot change inside a transaction.
  db.exec("PRAGMA foreign_keys = OFF");

  db.exec(`
    BEGIN;

    CREATE TABLE IF NOT EXISTS content_features (
      content_id INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
      feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      PRIMARY KEY (content_id, feature_id)
    );
    CREATE INDEX IF NOT EXISTS idx_content_features_feature ON content_features(feature_id);

    INSERT OR IGNORE INTO content_features (content_id, feature_id)
      SELECT id, feature_id FROM contents;

    DROP TRIGGER IF EXISTS contents_ai;
    DROP TRIGGER IF EXISTS contents_ad;
    DROP TRIGGER IF EXISTS contents_au;
    DROP TABLE IF EXISTS contents_fts;

    CREATE TABLE contents_new (
      id         INTEGER PRIMARY KEY,
      type       TEXT NOT NULL,
      title      TEXT,
      body       TEXT NOT NULL,
      embedding  BLOB,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO contents_new (id, type, title, body, embedding, created_at, updated_at)
      SELECT id, type, title, body, embedding, created_at, updated_at FROM contents;

    DROP TABLE contents;
    ALTER TABLE contents_new RENAME TO contents;

    COMMIT;
  `);

  db.transaction(() => {
    db.exec(FTS_AND_TRIGGERS.replace(/IF NOT EXISTS /g, ""));
    repopulateContentsFts(db);
  })();

  db.exec("PRAGMA foreign_keys = ON");
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
  db.transaction(() => {
    db.exec(FTS_AND_TRIGGERS.replace(/IF NOT EXISTS /g, ""));
    repopulateContentsFts(db);
  })();

  db.exec("PRAGMA foreign_keys = ON");
}
