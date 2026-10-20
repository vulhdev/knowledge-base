import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { applySchema } from "../../src/db/schema.js";
import { isCrsqliteReady, loadCrsqlite } from "../../src/team/crsqlite.js";

function createCrsqlDb(): Database.Database {
  const db = new Database(":memory:");
  loadSqliteVec(db);
  loadCrsqlite(db);
  applySchema(db);
  return db;
}

describe("openDb without cr-sqlite", () => {
  it("applySchema succeeds when cr-sqlite is not loaded", () => {
    const db = new Database(":memory:");
    loadSqliteVec(db);
    // do NOT load cr-sqlite — simulates extension absent
    expect(() => applySchema(db)).not.toThrow();
  });
});

describe.skipIf(!isCrsqliteReady())("Migration 17 — crsql_as_crr", () => {
  it("crsql_site_id() returns a non-empty buffer after loading extension", () => {
    const db = createCrsqlDb();
    const row = db.prepare("SELECT crsql_site_id() AS id").get() as { id: Buffer | string };
    expect(row.id).toBeTruthy();
  });

  it("crsql_changes virtual table is queryable", () => {
    const db = createCrsqlDb();
    expect(() =>
      db.prepare("SELECT tbl, pk, cid, val, col_version, db_version, site_id FROM crsql_changes").all()
    ).not.toThrow();
  });

  it("migration 17 is idempotent — calling applySchema twice does not throw", () => {
    const db = createCrsqlDb();
    expect(() => applySchema(db)).not.toThrow();
  });

  it("INSERT into workspaces produces a crsql_changes row", () => {
    const db = createCrsqlDb();
    db.prepare("INSERT INTO workspaces (name) VALUES (?)").run("test-ws");
    const changes = db
      .prepare("SELECT tbl FROM crsql_changes WHERE tbl = 'workspaces'")
      .all() as { tbl: string }[];
    expect(changes.length).toBeGreaterThan(0);
  });

  it("INSERT into features produces a crsql_changes row", () => {
    const db = createCrsqlDb();
    db.prepare("INSERT INTO workspaces (name) VALUES (?)").run("test-ws");
    const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get("test-ws") as { id: number };
    db.prepare("INSERT INTO features (workspace_id, name) VALUES (?, ?)").run(ws.id, "auth");
    const changes = db
      .prepare("SELECT tbl FROM crsql_changes WHERE tbl = 'features'")
      .all() as { tbl: string }[];
    expect(changes.length).toBeGreaterThan(0);
  });

  it("team_peers is NOT in crsql_changes (host-authoritative table)", () => {
    const db = createCrsqlDb();
    db.prepare(
      "INSERT INTO team_peers (public_key, display_name) VALUES (?, ?)"
    ).run("a".repeat(64), "@alice");
    const changes = db
      .prepare("SELECT tbl FROM crsql_changes WHERE tbl = 'team_peers'")
      .all() as { tbl: string }[];
    expect(changes.length).toBe(0);
  });
});
