import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { applySchema } from "../../src/db/schema.js";

const JP = "見積金額は原価に掛率を乗じて算出する。端数処理は切り捨て。";

/** DB as created by the pre-Migration-11 schema: external-content unicode61 FTS with plain triggers. */
function buildPre11Db(): Database.Database {
  const db = new Database(":memory:");
  loadSqliteVec(db);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE workspaces (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
    CREATE TABLE features (id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, UNIQUE(workspace_id, name));
    CREATE TABLE contents (id INTEGER PRIMARY KEY, type TEXT NOT NULL, title TEXT, body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), embedding BLOB);
    CREATE TABLE content_features (content_id INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
      feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE, PRIMARY KEY (content_id, feature_id));
    CREATE VIRTUAL TABLE contents_fts USING fts5(title, body, content=contents, content_rowid=id, tokenize='unicode61');
    CREATE TRIGGER contents_ai AFTER INSERT ON contents BEGIN
      INSERT INTO contents_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END;
    CREATE TRIGGER contents_ad AFTER DELETE ON contents BEGIN
      INSERT INTO contents_fts(contents_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
    END;
    CREATE TRIGGER contents_au AFTER UPDATE ON contents BEGIN
      INSERT INTO contents_fts(contents_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
      INSERT INTO contents_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END;
  `);
  db.prepare("INSERT INTO contents (type, title, body) VALUES ('doc', '原価の説明', ?)").run(JP);
  db.prepare("INSERT INTO contents (type, title, body) VALUES ('doc', 'english', 'plain english body')").run();
  return db;
}

const match = (db: Database.Database, q: string) =>
  (db.prepare("SELECT rowid FROM contents_fts WHERE contents_fts MATCH ?").all(q) as { rowid: number }[]).map((r) => r.rowid);
const sqlOf = (db: Database.Database, name: string) =>
  (db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name) as { sql: string }).sql;

describe("Migration 12 — contentless CJK-bigram contents_fts", () => {
  it("old DB: a 2-char JP term mid-sentence is not findable before the migration", () => {
    const db = buildPre11Db();
    expect(match(db, '"掛率"')).toEqual([]);
  });

  it("upgrades an old DB: contentless table, bigram triggers, row count equal, JP terms found", () => {
    const db = buildPre11Db();
    applySchema(db);
    expect(sqlOf(db, "contents_fts")).toContain("contentless_delete");
    expect(sqlOf(db, "contents_ai")).toContain("kb_cjk_bigram");
    const n = (t: string) => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect(n("contents_fts")).toBe(n("contents"));
    expect(match(db, '"掛率"')).toEqual([1]);
    expect(match(db, '"原価 価に に掛 掛率"')).toEqual([1]);
    expect(match(db, '"価掛"')).toEqual([]);
    expect(match(db, "english")).toEqual([2]);
  });

  it("is a no-op the second time", () => {
    const db = buildPre11Db();
    applySchema(db);
    const before = sqlOf(db, "contents_fts");
    db.exec("CREATE TABLE marker (x)");
    applySchema(db);
    expect(sqlOf(db, "contents_fts")).toBe(before);
    expect(match(db, '"掛率"')).toEqual([1]);
  });

  it("keeps triggers working after the upgrade: update and delete", () => {
    const db = buildPre11Db();
    applySchema(db);
    db.prepare("UPDATE contents SET body = '回次の採番' WHERE id = 1").run();
    expect(match(db, '"掛率"')).toEqual([]);
    expect(match(db, '"回次"')).toEqual([1]);
    db.prepare("DELETE FROM contents WHERE id = 1").run();
    expect(match(db, '"回次"')).toEqual([]);
  });

  it("table-recreation migrations (pre-Migration-2/9 DBs) build the new FTS, never unicode61 external-content", () => {
    const db = new Database(":memory:");
    loadSqliteVec(db);
    db.exec(`
      CREATE TABLE workspaces (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
      CREATE TABLE features (id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, UNIQUE(workspace_id, name));
      CREATE TABLE contents (id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('idea','spec')), body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE VIRTUAL TABLE contents_fts USING fts5(body, content=contents, content_rowid=id, tokenize='unicode61');
      CREATE TRIGGER contents_ai AFTER INSERT ON contents BEGIN INSERT INTO contents_fts(rowid, body) VALUES (new.id, new.body); END;
      INSERT INTO workspaces (name) VALUES ('ws');
      INSERT INTO features (workspace_id, name) VALUES (1, 'ft');
    `);
    db.prepare("INSERT INTO contents (feature_id, type, body) VALUES (1, 'idea', ?)").run(JP);
    applySchema(db);
    expect(sqlOf(db, "contents_fts")).toContain("contentless_delete");
    expect(sqlOf(db, "contents_fts")).not.toContain("content=contents");
    expect(match(db, '"端数 数処 処理"')).toEqual([1]);
  });

  it("is atomic: a failure while refilling leaves the old index and triggers, so the next start re-runs it", () => {
    const db = buildPre11Db();
    const realExec = db.exec.bind(db);
    const spy = vi.spyOn(db, "exec").mockImplementation((sql: string) => {
      if (sql.includes("SELECT id, kb_cjk_bigram(title), kb_cjk_bigram(body) FROM contents")) throw new Error("crash");
      return realExec(sql);
    });
    expect(() => applySchema(db)).toThrow(/crash/);
    spy.mockRestore();
    expect(sqlOf(db, "contents_fts")).not.toContain("contentless_delete");
    expect(sqlOf(db, "contents_ai")).not.toContain("kb_cjk_bigram");
    applySchema(db);
    expect(sqlOf(db, "contents_fts")).toContain("contentless_delete");
    expect(match(db, '"掛率"')).toEqual([1]);
  });
});
