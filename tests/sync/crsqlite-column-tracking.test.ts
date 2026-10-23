/**
 * Regression tests for cr-sqlite column tracking behavior.
 *
 * Verifies that cr-sqlite correctly propagates all column values (type, title, body)
 * across sync, including for content that existed before crsql_as_crr() was called.
 * Investigation confirmed: cr-sqlite DOES backfill all columns for pre-existing rows
 * when crsql_as_crr is called — the type/title NULL issue in production is NOT a
 * general cr-sqlite behavior bug.
 *
 * Skipped when crsqlite is not installed (run `npx knowledge-base init`).
 */
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { isCrsqliteReady, loadCrsqlite } from "../../src/team/crsqlite.js";
import * as net from "node:net";
import { applySchema } from "../../src/db/schema.js";
import { createWorkspace } from "../../src/db/workspaces.js";
import { insertTeam } from "../../src/db/team.js";
import { handleSyncConnection } from "../../src/sync/index.js";

type CrsqlRow = { tbl: string; pk: string; cid: string; val: unknown; db_version: number };

function queryCrdt(db: Database.Database, table: string): CrsqlRow[] {
  return db
    .prepare('SELECT "table" AS tbl, pk, cid, val, db_version FROM crsql_changes WHERE "table" = ?')
    .all(table) as CrsqlRow[];
}

function peerDb(workspaceName: string): Database.Database {
  const db = new Database(":memory:");
  loadSqliteVec(db);
  loadCrsqlite(db);
  applySchema(db);
  const ws = createWorkspace(db, workspaceName);
  insertTeam(db, ws.id, {
    role: "peer",
    secret: "a".repeat(64),
    noise_public_key: "b".repeat(64),
    noise_secret_key: "c".repeat(64),
    host_public_key: "d".repeat(64),
    last_synced_at: null,
  });
  return db;
}

describe.skipIf(!isCrsqliteReady())("cr-sqlite column tracking", () => {
  it("content created AFTER applySchema has all columns in crsql_changes (baseline)", () => {
    // This is the happy path: content created after crsql_as_crr is registered.
    const db = new Database(":memory:");
    loadSqliteVec(db);
    loadCrsqlite(db);
    applySchema(db); // registers crsql_as_crr('contents') internally

    db.prepare("INSERT INTO contents (type, title, body) VALUES (?, ?, ?)").run("spec", "My Title", "Hello");

    const changes = queryCrdt(db, "contents");
    const cids = changes.map((r) => r.cid);

    // All user-set columns must have a CRDT entry
    expect(cids).toContain("type");
    expect(cids).toContain("title");
    expect(cids).toContain("body");
  });

  it("content created BEFORE crsql_as_crr — which columns appear in crsql_changes?", () => {
    // Reproduces the migration-17 scenario: content was inserted when the DB had no
    // CRDT tracking. Does cr-sqlite backfill all column entries when crsql_as_crr
    // is called on a table that already has rows?
    const db = new Database(":memory:");
    loadSqliteVec(db);
    loadCrsqlite(db);

    // Create the table manually WITHOUT calling crsql_as_crr yet
    db.exec(`
      CREATE TABLE contents (
        id   TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        type TEXT NOT NULL DEFAULT '',
        title TEXT,
        body TEXT NOT NULL DEFAULT ''
      )
    `);

    // Insert BEFORE registering as CRR
    db.prepare("INSERT INTO contents (type, title, body) VALUES (?, ?, ?)").run("spec", "Pre-CRR title", "Pre-CRR body");

    // Now register as CRDT table (simulates migration 17/19)
    db.exec("SELECT crsql_as_crr('contents')");

    const changes = queryCrdt(db, "contents");
    const cids = changes.map((r) => r.cid);

    // cr-sqlite backfills ALL column values for pre-existing rows when crsql_as_crr is called.
    expect(cids).toContain("type");
    expect(cids).toContain("title");
    expect(cids).toContain("body");
  });

  it("peer receives correct type and title for content synced from host", async () => {
    // End-to-end check: does the peer get the right type/title values after sync?
    // If this fails, it confirms the type/title NULL issue from Image #2/#5.
    const WS = "col-tracking-ws";

    const hostDb = new Database(":memory:");
    loadSqliteVec(hostDb);
    loadCrsqlite(hostDb);
    applySchema(hostDb);
    createWorkspace(hostDb, WS);
    hostDb.prepare("INSERT INTO contents (type, title, body) VALUES (?, ?, ?)").run("spec", "Correct Title", "Body text");
    hostDb.prepare("INSERT INTO contents (type, title, body) VALUES (?, ?, ?)").run("plan", null, "Plan body");

    const peer = peerDb(WS);

    let serverSock!: net.Socket;
    let clientSock!: net.Socket;

    await new Promise<void>((resolve) => {
      const server = net.createServer((s) => { serverSock = s; if (clientSock) resolve(); });
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as net.AddressInfo;
        clientSock = net.createConnection(port, "127.0.0.1");
        clientSock.once("connect", () => { if (serverSock) { server.close(); resolve(); } });
      });
    });

    // Host side
    handleSyncConnection(hostDb, WS, serverSock as unknown as NodeJS.ReadWriteStream);
    // Peer side
    handleSyncConnection(peer, WS, clientSock as unknown as NodeJS.ReadWriteStream);

    await new Promise((r) => setTimeout(r, 300));
    serverSock.end();
    await new Promise((r) => setTimeout(r, 100));

    const rows = peer
      .prepare("SELECT type, title, body FROM contents ORDER BY created_at")
      .all() as { type: string | null; title: string | null; body: string }[];

    expect(rows).toHaveLength(2);
    expect(rows[0]?.type).toBe("spec");
    expect(rows[0]?.title).toBe("Correct Title");
    expect(rows[1]?.type).toBe("plan");
    expect(rows[1]?.title).toBeNull(); // intentionally null — inserted without title

    clientSock.destroy();
    serverSock.destroy();
  });
});
