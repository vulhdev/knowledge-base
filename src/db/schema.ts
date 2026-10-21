import type Database from "better-sqlite3";
import { bigramIndexText } from "../text/cjk-bigram.js";

const VEC_TABLE_AND_TRIGGERS = `
  CREATE VIRTUAL TABLE IF NOT EXISTS vec_contents USING vec0(
    embedding float[384]
  );

  CREATE TRIGGER IF NOT EXISTS contents_vec_ai AFTER INSERT ON contents
  WHEN new.embedding IS NOT NULL BEGIN
    INSERT INTO vec_contents(rowid, embedding) VALUES (new.rowid, new.embedding);
  END;

  CREATE TRIGGER IF NOT EXISTS contents_vec_au AFTER UPDATE ON contents
  WHEN new.embedding IS NOT NULL BEGIN
    DELETE FROM vec_contents WHERE rowid = old.rowid;
    INSERT INTO vec_contents(rowid, embedding) VALUES (new.rowid, new.embedding);
  END;

  CREATE TRIGGER IF NOT EXISTS contents_vec_ad AFTER DELETE ON contents BEGIN
    DELETE FROM vec_contents WHERE rowid = old.rowid;
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
    INSERT INTO contents_fts(rowid, title, body) VALUES (new.rowid, kb_cjk_bigram(new.title), kb_cjk_bigram(new.body));
  END;

  CREATE TRIGGER IF NOT EXISTS contents_ad AFTER DELETE ON contents BEGIN
    DELETE FROM contents_fts WHERE rowid = old.rowid;
  END;

  CREATE TRIGGER IF NOT EXISTS contents_au AFTER UPDATE ON contents BEGIN
    DELETE FROM contents_fts WHERE rowid = old.rowid;
    INSERT INTO contents_fts(rowid, title, body) VALUES (new.rowid, kb_cjk_bigram(new.title), kb_cjk_bigram(new.body));
  END;
`;

// Contentless FTS cannot 'rebuild' from contents — refill it through the same bigram function the triggers use.
function repopulateContentsFts(db: Database.Database): void {
  db.exec(`
    DELETE FROM contents_fts;
    INSERT INTO contents_fts(rowid, title, body)
      SELECT rowid, kb_cjk_bigram(title), kb_cjk_bigram(body) FROM contents;
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
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
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

// Migration 19: convert contents.id from INTEGER to TEXT UUID so each peer's rows never
// collide in CRSQLite LWW merge. Rebuilds all FK child tables and vec/fts indexes.
function migrateContentsToUuid(db: Database.Database): void {
  const isCrsqlLoaded = (() => {
    try { db.prepare("SELECT crsql_site_id()").get(); return true; } catch { return false; }
  })();

  // vec_contents is normally created by VEC_TABLE_AND_TRIGGERS after runMigrations, but
  // migration 19 needs it earlier to rebuild the index. Create it here if not yet present.
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS vec_contents USING vec0(embedding float[384])");

  db.exec("PRAGMA foreign_keys = OFF");

  db.exec(`
    BEGIN;

    DROP TABLE IF EXISTS _content_chunks_uuid;
    DROP TABLE IF EXISTS _reviews_uuid;
    DROP TABLE IF EXISTS _code_refs_uuid;
    DROP TABLE IF EXISTS _content_links_uuid;
    DROP TABLE IF EXISTS _content_features_uuid;
    DROP TABLE IF EXISTS _contents_uuid;
    DROP TABLE IF EXISTS _uuid_map;

    CREATE TABLE _uuid_map (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);
    INSERT INTO _uuid_map (old_id, new_id)
      SELECT id, lower(hex(randomblob(16))) FROM contents;

    DROP TRIGGER IF EXISTS contents_ai;
    DROP TRIGGER IF EXISTS contents_au;
    DROP TRIGGER IF EXISTS contents_ad;
    DROP TABLE IF EXISTS contents_fts;
    DROP TRIGGER IF EXISTS contents_vec_ai;
    DROP TRIGGER IF EXISTS contents_vec_au;
    DROP TRIGGER IF EXISTS contents_vec_ad;

    CREATE TABLE _contents_uuid (
      id             TEXT    NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      type           TEXT    NOT NULL DEFAULT '',
      title          TEXT,
      body           TEXT    NOT NULL DEFAULT '',
      embedding      BLOB,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      root_id        TEXT,
      version_number INTEGER NOT NULL DEFAULT 1,
      is_latest      INTEGER NOT NULL DEFAULT 1,
      created_by     TEXT,
      updated_by     TEXT,
      source_key     TEXT,
      source_sha     TEXT
    );
    INSERT INTO _contents_uuid
      (id, type, title, body, embedding, created_at, updated_at,
       root_id, version_number, is_latest, created_by, updated_by, source_key, source_sha)
    SELECT m.new_id, c.type, c.title, c.body, c.embedding, c.created_at, c.updated_at,
           r.new_id, c.version_number, c.is_latest, c.created_by, c.updated_by,
           c.source_key, c.source_sha
    FROM contents c
    JOIN _uuid_map m ON m.old_id = c.id
    LEFT JOIN _uuid_map r ON r.old_id = c.root_id;

    CREATE TABLE _content_features_uuid (
      content_id TEXT    NOT NULL,
      feature_id INTEGER NOT NULL,
      PRIMARY KEY (content_id, feature_id)
    );
    INSERT INTO _content_features_uuid (content_id, feature_id)
      SELECT m.new_id, cf.feature_id
      FROM content_features cf JOIN _uuid_map m ON m.old_id = cf.content_id;
    DROP TABLE content_features;
    ALTER TABLE _content_features_uuid RENAME TO content_features;
    CREATE INDEX IF NOT EXISTS idx_content_features_feature ON content_features(feature_id);

    CREATE TABLE _content_links_uuid (
      parent_id  TEXT NOT NULL,
      child_id   TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (parent_id, child_id)
    );
    INSERT INTO _content_links_uuid (parent_id, child_id, created_at)
      SELECT mp.new_id, mc.new_id, cl.created_at
      FROM content_links cl
      JOIN _uuid_map mp ON mp.old_id = cl.parent_id
      JOIN _uuid_map mc ON mc.old_id = cl.child_id;
    DROP TABLE content_links;
    ALTER TABLE _content_links_uuid RENAME TO content_links;
    CREATE INDEX IF NOT EXISTS idx_content_links_child ON content_links(child_id);

    CREATE TABLE _code_refs_uuid (
      id          INTEGER PRIMARY KEY,
      content_id  TEXT    NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
      task_ref    TEXT,
      commit_hash TEXT    NOT NULL DEFAULT '',
      file_paths  TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(content_id, commit_hash)
    );
    INSERT INTO _code_refs_uuid (id, content_id, task_ref, commit_hash, file_paths, created_at)
      SELECT cr.id, m.new_id, cr.task_ref, cr.commit_hash, cr.file_paths, cr.created_at
      FROM code_refs cr JOIN _uuid_map m ON m.old_id = cr.content_id;
    DROP TABLE code_refs;
    ALTER TABLE _code_refs_uuid RENAME TO code_refs;
    CREATE INDEX IF NOT EXISTS idx_code_refs_content ON code_refs(content_id);

    CREATE TABLE _reviews_uuid (
      id           INTEGER PRIMARY KEY,
      content_id   TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      committed_at TEXT
    );
    INSERT INTO _reviews_uuid (id, content_id, status, created_at, committed_at)
      SELECT rv.id, m.new_id, rv.status, rv.created_at, rv.committed_at
      FROM reviews rv JOIN _uuid_map m ON m.old_id = rv.content_id;
    DROP TABLE reviews;
    ALTER TABLE _reviews_uuid RENAME TO reviews;
    CREATE INDEX IF NOT EXISTS idx_reviews_content ON reviews(content_id);

    CREATE TABLE _content_chunks_uuid (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id    TEXT    NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
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
    INSERT INTO _content_chunks_uuid
      (id, content_id, kind, chunk_key, ord, heading_path, start_char, end_char,
       start_line, end_line, source_path, source_commit, chunk_sha, embedding)
    SELECT cc.id, m.new_id, cc.kind, cc.chunk_key, cc.ord, cc.heading_path,
           cc.start_char, cc.end_char, cc.start_line, cc.end_line,
           cc.source_path, cc.source_commit, cc.chunk_sha, cc.embedding
    FROM content_chunks cc JOIN _uuid_map m ON m.old_id = cc.content_id;
    DROP TABLE content_chunks;
    ALTER TABLE _content_chunks_uuid RENAME TO content_chunks;
    CREATE INDEX IF NOT EXISTS idx_content_chunks_content ON content_chunks(content_id);

    DROP TABLE contents;
    ALTER TABLE _contents_uuid RENAME TO contents;

    CREATE INDEX IF NOT EXISTS idx_contents_root_id ON contents(root_id);
    CREATE INDEX IF NOT EXISTS idx_contents_created_at ON contents(created_at, id) WHERE is_latest = 1;
    CREATE INDEX IF NOT EXISTS idx_contents_type_created_at ON contents(type, created_at, id) WHERE is_latest = 1;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contents_source_key ON contents(source_key) WHERE source_key IS NOT NULL;

    DROP TABLE IF EXISTS _uuid_map;
    COMMIT;
  `);

  db.transaction(() => {
    db.exec(FTS_AND_TRIGGERS.replace(/IF NOT EXISTS /g, ""));
    repopulateContentsFts(db);
  })();

  db.exec(`
    DELETE FROM vec_contents;
    CREATE TRIGGER contents_vec_ai AFTER INSERT ON contents
    WHEN new.embedding IS NOT NULL BEGIN
      INSERT INTO vec_contents(rowid, embedding) VALUES (new.rowid, new.embedding);
    END;
    CREATE TRIGGER contents_vec_au AFTER UPDATE ON contents
    WHEN new.embedding IS NOT NULL BEGIN
      DELETE FROM vec_contents WHERE rowid = old.rowid;
      INSERT INTO vec_contents(rowid, embedding) VALUES (new.rowid, new.embedding);
    END;
    CREATE TRIGGER contents_vec_ad AFTER DELETE ON contents BEGIN
      DELETE FROM vec_contents WHERE rowid = old.rowid;
    END;
  `);
  db.exec(
    `INSERT INTO vec_contents(rowid, embedding)
       SELECT rowid, embedding FROM contents WHERE embedding IS NOT NULL`,
  );

  if (isCrsqlLoaded) {
    db.exec("DROP INDEX IF EXISTS idx_contents_source_key");
    db.exec("DROP INDEX IF EXISTS uq_feature_digest");
    db.exec("SELECT crsql_as_crr('contents')");
    db.exec("CREATE INDEX IF NOT EXISTS idx_contents_source_key ON contents(source_key) WHERE source_key IS NOT NULL");
    db.exec("SELECT crsql_as_crr('content_features')");
    db.exec("SELECT crsql_as_crr('content_links')");
  }

  db.exec("PRAGMA foreign_keys = ON");
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

  // Migration 11: add versioning columns (root_id, version_number, is_latest)
  const hasRootId = (
    db.prepare("SELECT COUNT(*) AS cnt FROM pragma_table_info('contents') WHERE name = 'root_id'").get() as { cnt: number }
  ).cnt > 0;

  if (!hasRootId) {
    db.exec("ALTER TABLE contents ADD COLUMN root_id INTEGER REFERENCES contents(id)");
  }

  const hasVersionNumber = (
    db.prepare("SELECT COUNT(*) AS cnt FROM pragma_table_info('contents') WHERE name = 'version_number'").get() as { cnt: number }
  ).cnt > 0;

  if (!hasVersionNumber) {
    db.exec("ALTER TABLE contents ADD COLUMN version_number INTEGER NOT NULL DEFAULT 1");
  }

  const hasIsLatest = (
    db.prepare("SELECT COUNT(*) AS cnt FROM pragma_table_info('contents') WHERE name = 'is_latest'").get() as { cnt: number }
  ).cnt > 0;

  if (!hasIsLatest) {
    db.exec("ALTER TABLE contents ADD COLUMN is_latest INTEGER NOT NULL DEFAULT 1");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_contents_root_id ON contents(root_id);
  `);

  // Migration 12: team_peers table + created_by/updated_by on contents
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_peers (
      id           INTEGER PRIMARY KEY NOT NULL,
      public_key   TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      is_active    INTEGER NOT NULL DEFAULT 1,
      joined_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const hasCreatedBy = (
    db.prepare("SELECT COUNT(*) AS cnt FROM pragma_table_info('contents') WHERE name = 'created_by'").get() as { cnt: number }
  ).cnt > 0;
  if (!hasCreatedBy) {
    db.exec("ALTER TABLE contents ADD COLUMN created_by TEXT");
  }

  const hasUpdatedBy = (
    db.prepare("SELECT COUNT(*) AS cnt FROM pragma_table_info('contents') WHERE name = 'updated_by'").get() as { cnt: number }
  ).cnt > 0;
  if (!hasUpdatedBy) {
    db.exec("ALTER TABLE contents ADD COLUMN updated_by TEXT");
  }


  // Rebuild list-path indexes as partial indexes covering only is_latest=1 rows,
  // so list_contents queries retain their index-scan-ordered plan after the is_latest filter.
  const createdAtIdx = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_contents_created_at'").get() as { sql: string } | undefined
  )?.sql ?? "";

  if (!createdAtIdx.includes("WHERE")) {
    db.exec(`
      DROP INDEX IF EXISTS idx_contents_created_at;
      CREATE INDEX idx_contents_created_at ON contents(created_at) WHERE is_latest = 1;
      DROP INDEX IF EXISTS idx_contents_type_created_at;
      CREATE INDEX idx_contents_type_created_at ON contents(type, created_at) WHERE is_latest = 1;
    `);
  }
  // Migration 13: add github_username to team_peers
  const hasGithubUsername = (
    db.prepare("SELECT COUNT(*) AS cnt FROM pragma_table_info('team_peers') WHERE name = 'github_username'").get() as { cnt: number }
  ).cnt > 0;
  if (!hasGithubUsername) {
    const hasPeersTable = (
      db.prepare("SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='team_peers'").get() as { cnt: number }
    ).cnt > 0;
    if (hasPeersTable) {
      db.exec("ALTER TABLE team_peers ADD COLUMN github_username TEXT");
    }
  }

  // Migration 14: contents_fts becomes contentless and indexes CJK as bigrams (kb_cjk_bigram)
  const fts14 = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'contents_fts'")
      .get() as { sql: string } | undefined
  )?.sql ?? "";
  const trigger14 = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'contents_ai'")
      .get() as { sql: string } | undefined
  )?.sql ?? "";

  if (!fts14.includes("contentless_delete") || !trigger14.includes("kb_cjk_bigram")) {
    recreateContentsFts(db);
  }

  // Migration 15: section rows (offset-only, no text) for docs and SOT pointers, plus the
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

  // Migration 16: provenance of imported rows — source_key (unique when set) and source_sha
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

  // Migration 18: workspace team config moved from settings.json to SQLite
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_team (
      workspace_id     INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      role             TEXT NOT NULL CHECK(role IN ('host', 'peer')),
      secret           TEXT NOT NULL,
      noise_public_key TEXT NOT NULL,
      noise_secret_key TEXT NOT NULL,
      host_public_key  TEXT,
      last_synced_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS workspace_invites (
      id               INTEGER PRIMARY KEY,
      workspace_id     INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      github_username  TEXT NOT NULL,
      invited_at       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(workspace_id, github_username)
    );
  `);

  // Migration 17: register CRDT-replicated tables with cr-sqlite (idempotent)
  // Only runs when the cr-sqlite extension is loaded in this DB instance.
  //
  // workspaces and features are excluded: cr-sqlite forbids UNIQUE indices beyond the PK on CRR
  // tables (workspaces.name and features(workspace_id,name) are UNIQUE). These are structural/
  // config tables managed locally by each peer and do not need CRDT replication.
  //
  // contents has two partial unique indices that must be dropped before crsql_as_crr:
  //   - idx_contents_source_key (migration 16, always present)
  //   - uq_feature_digest (migration 2, only on older DBs that had the CHECK constraint)
  // Both are recreated as non-unique indices afterward to preserve query performance.
  const isCrsqlLoaded = (() => {
    try { db.prepare("SELECT crsql_site_id()").get(); return true; } catch { return false; }
  })();
  if (isCrsqlLoaded) {
    ensureContentsIdNotNull(db);
    db.exec("DROP INDEX IF EXISTS idx_contents_source_key");
    db.exec("DROP INDEX IF EXISTS uq_feature_digest");
    db.exec(`SELECT crsql_as_crr('contents')`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_contents_source_key ON contents(source_key) WHERE source_key IS NOT NULL");
    ensureContentFeaturesForCrr(db);
    db.exec(`SELECT crsql_as_crr('content_features')`);
    ensureContentLinksForCrr(db);
    db.exec(`SELECT crsql_as_crr('content_links')`);
  }

  // Migration 19: convert contents.id from INTEGER to TEXT UUID
  const { type: contentsIdType } = db.prepare(
    "SELECT type FROM pragma_table_info('contents') WHERE name = 'id'"
  ).get() as { type: string };
  if (contentsIdType.toUpperCase() !== "TEXT") {
    migrateContentsToUuid(db);
  }
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

function ensureContentsIdNotNull(db: Database.Database): void {
  // cr-sqlite requires the primary key to have notnull=1 in PRAGMA table_info.
  // SQLite's INTEGER PRIMARY KEY implicitly reports notnull=0 even though the rowid
  // alias is never null. Recreate contents with an explicit NOT NULL on the PK.
  const cols = db.prepare("PRAGMA table_info('contents')").all() as Array<{
    name: string; notnull: number; pk: number; dflt_value: string | null;
  }>;
  const idCol = cols.find(r => r.pk === 1);
  // cr-sqlite CRR requirements: PK must be notnull=1; every NOT NULL non-PK column must have a
  // DEFAULT so the table can evolve across schema versions on different peers.
  const needsRebuild =
    (idCol !== undefined && idCol.notnull === 0) ||
    cols.some(r => r.pk === 0 && r.notnull === 1 && r.dflt_value === null);
  if (!needsRebuild) return;

  db.exec("PRAGMA foreign_keys = OFF");

  db.exec(`
    BEGIN;

    DROP TRIGGER IF EXISTS contents_ai;
    DROP TRIGGER IF EXISTS contents_au;
    DROP TRIGGER IF EXISTS contents_ad;
    DROP TABLE IF EXISTS contents_fts;

    CREATE TABLE contents_new (
      id             INTEGER NOT NULL PRIMARY KEY,
      type           TEXT NOT NULL DEFAULT '',
      title          TEXT,
      body           TEXT NOT NULL DEFAULT '',
      embedding      BLOB,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      root_id        INTEGER,
      version_number INTEGER NOT NULL DEFAULT 1,
      is_latest      INTEGER NOT NULL DEFAULT 1,
      created_by     TEXT,
      updated_by     TEXT,
      source_key     TEXT,
      source_sha     TEXT
    );

    INSERT INTO contents_new
      SELECT id, type, title, body, embedding, created_at, updated_at,
             root_id, version_number, is_latest, created_by, updated_by,
             source_key, source_sha
      FROM contents;

    DROP TABLE contents;
    ALTER TABLE contents_new RENAME TO contents;

    CREATE INDEX IF NOT EXISTS idx_contents_root_id ON contents(root_id);
    CREATE INDEX IF NOT EXISTS idx_contents_created_at ON contents(created_at) WHERE is_latest = 1;
    CREATE INDEX IF NOT EXISTS idx_contents_type_created_at ON contents(type, created_at) WHERE is_latest = 1;

    COMMIT;
  `);

  db.transaction(() => {
    db.exec(FTS_AND_TRIGGERS.replace(/IF NOT EXISTS /g, ""));
    repopulateContentsFts(db);
  })();

  db.exec("PRAGMA foreign_keys = ON");
}

function ensureContentFeaturesForCrr(db: Database.Database): void {
  // cr-sqlite forbids checked (enforced) FK constraints on CRR tables, and requires
  // NOT NULL non-PK columns to have DEFAULT values. Recreate without FK constraints.
  const sql = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='content_features'").get() as
      | { sql: string } | undefined
  )?.sql ?? "";
  if (!sql.includes("REFERENCES")) return;

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(`
    BEGIN;
    CREATE TABLE content_features_new (
      content_id INTEGER NOT NULL DEFAULT 0,
      feature_id INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (content_id, feature_id)
    );
    INSERT INTO content_features_new SELECT content_id, feature_id FROM content_features;
    DROP TABLE content_features;
    ALTER TABLE content_features_new RENAME TO content_features;
    CREATE INDEX IF NOT EXISTS idx_content_features_feature ON content_features(feature_id);
    COMMIT;
  `);
  db.exec("PRAGMA foreign_keys = ON");
}

function ensureContentLinksForCrr(db: Database.Database): void {
  // cr-sqlite forbids checked FK constraints on CRR tables, and requires NOT NULL non-PK
  // columns with DEFAULT values. Recreate without FK constraints.
  const sql = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='content_links'").get() as
      | { sql: string } | undefined
  )?.sql ?? "";
  if (!sql.includes("REFERENCES")) return;

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(`
    BEGIN;
    CREATE TABLE content_links_new (
      parent_id  INTEGER NOT NULL DEFAULT 0,
      child_id   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (parent_id, child_id)
    );
    INSERT INTO content_links_new SELECT parent_id, child_id, created_at FROM content_links;
    DROP TABLE content_links;
    ALTER TABLE content_links_new RENAME TO content_links;
    CREATE INDEX IF NOT EXISTS idx_content_links_child ON content_links(child_id);
    COMMIT;
  `);
  db.exec("PRAGMA foreign_keys = ON");
}
