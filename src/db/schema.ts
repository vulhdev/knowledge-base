import type { DatabaseSync } from "node:sqlite";

export function applySchema(db: DatabaseSync): void {
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
      type       TEXT NOT NULL CHECK(type IN ('idea', 'spec', 'plan', 'digest')),
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_feature_digest
      ON contents(feature_id) WHERE type = 'digest';

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
  `);
}
