/**
 * Integration tests for performInitialSync using real TCP sockets.
 *
 * Unlike initial.test.ts (which mocks handleSyncConnection entirely), these tests
 * wire a real host DB to a real peer DB through loopback TCP so the full
 * handshake + changeset exchange runs. They confirm that a joining peer actually
 * receives the host's documents — the scenario that was timing out in the field.
 *
 * Hyperswarm is still mocked because we don't want DHT; we fire the "connection"
 * event manually with a real net.Socket so every other layer is genuine.
 *
 * Skipped when crsqlite extension is not installed (run `npx knowledge-base init`).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as net from "node:net";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { applySchema } from "../../src/db/schema.js";
import { isCrsqliteReady, loadCrsqlite } from "../../src/team/crsqlite.js";
import { createWorkspace } from "../../src/db/workspaces.js";
import { insertTeam } from "../../src/db/team.js";
import { handleSyncConnection } from "../../src/sync/index.js";

// ---------------------------------------------------------------------------
// Hyperswarm mock — captures the "connection" handler so we can fire it with a
// real net.Socket instead of going through DHT.
// ---------------------------------------------------------------------------

let connectionHandler: ((socket: NodeJS.ReadWriteStream) => void) | null = null;

vi.mock("hyperswarm", () => ({
  default: vi.fn().mockImplementation(() => ({
    join: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockImplementation((event: string, handler: unknown) => {
      if (event === "connection") {
        connectionHandler = handler as (socket: NodeJS.ReadWriteStream) => void;
      }
    }),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCrsqlDb(): Database.Database {
  const db = new Database(":memory:");
  loadSqliteVec(db);
  loadCrsqlite(db);
  applySchema(db);
  return db;
}

function seedPeerTeam(db: Database.Database, workspaceName: string): void {
  const ws = createWorkspace(db, workspaceName);
  insertTeam(db, ws.id, {
    role: "peer",
    secret: "a".repeat(64),
    noise_public_key: "b".repeat(64),
    noise_secret_key: "c".repeat(64),
    host_public_key: "d".repeat(64),
    last_synced_at: null,
  });
}

/** Returns a connected TCP pair. Caller must destroy both sockets when done. */
async function makeTcpPair(): Promise<{ clientSocket: net.Socket; serverSocket: net.Socket }> {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as net.AddressInfo;

  const [clientSocket, serverSocket] = await Promise.all([
    new Promise<net.Socket>((resolve) => {
      const s = net.createConnection(port, "127.0.0.1");
      s.once("connect", () => resolve(s));
    }),
    new Promise<net.Socket>((resolve) => {
      server.once("connection", resolve);
    }),
  ]);

  server.close();
  return { clientSocket, serverSocket };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!isCrsqliteReady())(
  "performInitialSync — TCP integration",
  () => {
    afterEach(() => {
      connectionHandler = null;
      vi.clearAllMocks();
    });

    it("peer receives all documents from host after joining", async () => {
      const WS = "myws";

      const hostDb = createCrsqlDb();
      createWorkspace(hostDb, WS);
      hostDb.prepare("INSERT INTO contents (type, body) VALUES (?, ?)").run("idea", "host doc 1");
      hostDb.prepare("INSERT INTO contents (type, body) VALUES (?, ?)").run("spec", "host doc 2");
      hostDb.prepare("INSERT INTO contents (type, body) VALUES (?, ?)").run("plan", "host doc 3");

      const peerDb = createCrsqlDb();
      seedPeerTeam(peerDb, WS);

      const { performInitialSync } = await import("../../src/sync/initial.js");
      const syncPromise = performInitialSync(peerDb, WS, 5_000);

      // Wait for the Hyperswarm mock to register the connection handler.
      await new Promise((r) => setTimeout(r, 20));
      expect(connectionHandler).not.toBeNull();

      const { clientSocket, serverSocket } = await makeTcpPair();

      // Host side handles the server socket — sends its changeset to peer.
      handleSyncConnection(hostDb, WS, serverSocket as unknown as NodeJS.ReadWriteStream);

      // Fire the connection inside performInitialSync with the client socket.
      connectionHandler!(clientSocket as unknown as NodeJS.ReadWriteStream);

      // Allow the handshake + changeset exchange to complete over loopback TCP,
      // then close the server side so the peer socket emits "close" and the
      // promise resolves.
      await new Promise((r) => setTimeout(r, 200));
      serverSocket.end();

      const result = await syncPromise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rowsReceived).toBeGreaterThan(0);
      }

      const count = (
        peerDb.prepare("SELECT count(*) AS n FROM contents").get() as { n: number }
      ).n;
      expect(count).toBe(3);

      clientSocket.destroy();
      serverSocket.destroy();
    });

    it("resolves with 0 rows when host workspace has no documents", async () => {
      const WS = "emptyws";

      const hostDb = createCrsqlDb();
      createWorkspace(hostDb, WS);
      // no content inserted

      const peerDb = createCrsqlDb();
      seedPeerTeam(peerDb, WS);

      const { performInitialSync } = await import("../../src/sync/initial.js");
      const syncPromise = performInitialSync(peerDb, WS, 5_000);

      await new Promise((r) => setTimeout(r, 20));
      expect(connectionHandler).not.toBeNull();

      const { clientSocket, serverSocket } = await makeTcpPair();

      handleSyncConnection(hostDb, WS, serverSocket as unknown as NodeJS.ReadWriteStream);
      connectionHandler!(clientSocket as unknown as NodeJS.ReadWriteStream);

      await new Promise((r) => setTimeout(r, 200));
      serverSocket.end();

      const result = await syncPromise;

      expect(result).toEqual({ ok: true, rowsReceived: 0, featuresBootstrapped: 0 });

      const count = (
        peerDb.prepare("SELECT count(*) AS n FROM contents").get() as { n: number }
      ).n;
      expect(count).toBe(0);

      clientSocket.destroy();
      serverSocket.destroy();
    });

    // Bug: host only sent bootstrap when peerVersion === 0, so re-joining peers
    // (with CRDT data from a prior partial sync) never received features.
    it("peer receives features from host bootstrap even when peer already has CRDT data (non-zero dbVersion)", async () => {
      const WS = "feat-rejoin-ws";

      const hostDb = createCrsqlDb();
      createWorkspace(hostDb, WS);
      hostDb.prepare("INSERT INTO contents (type, body) VALUES (?, ?)").run("spec", "host doc");
      const wsId = (hostDb.prepare("SELECT id FROM workspaces WHERE name = ?").get(WS) as { id: number }).id;
      hostDb.prepare("INSERT INTO features (workspace_id, name) VALUES (?, ?)").run(wsId, "alpha");
      hostDb.prepare("INSERT INTO features (workspace_id, name) VALUES (?, ?)").run(wsId, "beta");

      // Peer has prior CRDT data — simulates a previous partial join attempt.
      const peerDb = createCrsqlDb();
      seedPeerTeam(peerDb, WS);
      // Insert a content row so peerDb has non-zero localDbVersion in crsql_changes.
      peerDb.prepare("INSERT INTO contents (type, body) VALUES (?, ?)").run("idea", "pre-existing");
      const { v: peerDbVersion } = peerDb
        .prepare("SELECT MAX(db_version) AS v FROM crsql_changes")
        .get() as { v: number | null };
      expect(peerDbVersion).toBeGreaterThan(0); // confirm peer is in "re-join" state

      const { performInitialSync } = await import("../../src/sync/initial.js");
      const syncPromise = performInitialSync(peerDb, WS, 5_000);

      await new Promise((r) => setTimeout(r, 20));
      expect(connectionHandler).not.toBeNull();

      const { clientSocket, serverSocket } = await makeTcpPair();
      handleSyncConnection(hostDb, WS, serverSocket as unknown as NodeJS.ReadWriteStream);
      connectionHandler!(clientSocket as unknown as NodeJS.ReadWriteStream);

      await new Promise((r) => setTimeout(r, 200));
      serverSocket.end();
      await syncPromise;

      // Bug manifests here: features table is empty on the peer because bootstrap was never sent.
      const peerWsId = (peerDb.prepare("SELECT id FROM workspaces WHERE name = ?").get(WS) as { id: number }).id;
      const peerFeatures = peerDb
        .prepare("SELECT name FROM features WHERE workspace_id = ?")
        .all(peerWsId) as { name: string }[];
      const featureNames = peerFeatures.map((f) => f.name);
      expect(featureNames).toContain("alpha");
      expect(featureNames).toContain("beta");

      clientSocket.destroy();
      serverSocket.destroy();
    });

    it("features bootstrap is idempotent — re-syncing does not duplicate features on peer", async () => {
      const WS = "feat-idem-ws";

      const hostDb = createCrsqlDb();
      createWorkspace(hostDb, WS);
      const wsId = (hostDb.prepare("SELECT id FROM workspaces WHERE name = ?").get(WS) as { id: number }).id;
      hostDb.prepare("INSERT INTO features (workspace_id, name) VALUES (?, ?)").run(wsId, "gamma");

      const peerDb = createCrsqlDb();
      seedPeerTeam(peerDb, WS);

      const { performInitialSync } = await import("../../src/sync/initial.js");

      const runSync = async () => {
        const syncPromise = performInitialSync(peerDb, WS, 5_000);
        await new Promise((r) => setTimeout(r, 20));
        const { clientSocket, serverSocket } = await makeTcpPair();
        handleSyncConnection(hostDb, WS, serverSocket as unknown as NodeJS.ReadWriteStream);
        connectionHandler!(clientSocket as unknown as NodeJS.ReadWriteStream);
        await new Promise((r) => setTimeout(r, 200));
        serverSocket.end();
        const result = await syncPromise;
        clientSocket.destroy();
        serverSocket.destroy();
        connectionHandler = null;
        vi.clearAllMocks();
        return result;
      };

      await runSync();
      await runSync(); // second sync — must not duplicate features

      const peerWsId = (peerDb.prepare("SELECT id FROM workspaces WHERE name = ?").get(WS) as { id: number }).id;
      const count = (
        peerDb.prepare("SELECT count(*) AS n FROM features WHERE workspace_id = ?").get(peerWsId) as { n: number }
      ).n;
      expect(count).toBe(1); // exactly one, not two
    });

    it("featuresBootstrapped count is reported in sync result", async () => {
      const WS = "feat-count-ws";

      const hostDb = createCrsqlDb();
      createWorkspace(hostDb, WS);
      const wsId = (hostDb.prepare("SELECT id FROM workspaces WHERE name = ?").get(WS) as { id: number }).id;
      hostDb.prepare("INSERT INTO features (workspace_id, name) VALUES (?, ?)").run(wsId, "f1");
      hostDb.prepare("INSERT INTO features (workspace_id, name) VALUES (?, ?)").run(wsId, "f2");
      hostDb.prepare("INSERT INTO features (workspace_id, name) VALUES (?, ?)").run(wsId, "f3");

      const peerDb = createCrsqlDb();
      seedPeerTeam(peerDb, WS);

      const { performInitialSync } = await import("../../src/sync/initial.js");
      const syncPromise = performInitialSync(peerDb, WS, 5_000);

      await new Promise((r) => setTimeout(r, 20));
      const { clientSocket, serverSocket } = await makeTcpPair();
      handleSyncConnection(hostDb, WS, serverSocket as unknown as NodeJS.ReadWriteStream);
      connectionHandler!(clientSocket as unknown as NodeJS.ReadWriteStream);
      await new Promise((r) => setTimeout(r, 200));
      serverSocket.end();

      const result = await syncPromise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        // featuresBootstrapped tracks how many feature names arrived via the bootstrap frame.
        expect(result.featuresBootstrapped).toBe(3);
      }

      clientSocket.destroy();
      serverSocket.destroy();
    });

    it("peer does not duplicate documents if already synced (idempotent apply)", async () => {
      const WS = "idempws";

      const hostDb = createCrsqlDb();
      createWorkspace(hostDb, WS);
      hostDb.prepare("INSERT INTO contents (type, body) VALUES (?, ?)").run("idea", "shared doc");

      const peerDb = createCrsqlDb();
      seedPeerTeam(peerDb, WS);

      const { performInitialSync } = await import("../../src/sync/initial.js");

      // First sync
      {
        const syncPromise = performInitialSync(peerDb, WS, 5_000);
        await new Promise((r) => setTimeout(r, 20));
        const { clientSocket, serverSocket } = await makeTcpPair();
        handleSyncConnection(hostDb, WS, serverSocket as unknown as NodeJS.ReadWriteStream);
        connectionHandler!(clientSocket as unknown as NodeJS.ReadWriteStream);
        await new Promise((r) => setTimeout(r, 200));
        serverSocket.end();
        await syncPromise;
        clientSocket.destroy();
        serverSocket.destroy();
      }

      const countAfterFirst = (
        peerDb.prepare("SELECT count(*) AS n FROM contents").get() as { n: number }
      ).n;
      expect(countAfterFirst).toBe(1);

      // Reset handler for second sync
      connectionHandler = null;
      vi.clearAllMocks();

      // Second sync — same data, same docs
      {
        const syncPromise2 = performInitialSync(peerDb, WS, 5_000);
        await new Promise((r) => setTimeout(r, 20));
        const { clientSocket, serverSocket } = await makeTcpPair();
        handleSyncConnection(hostDb, WS, serverSocket as unknown as NodeJS.ReadWriteStream);
        connectionHandler!(clientSocket as unknown as NodeJS.ReadWriteStream);
        await new Promise((r) => setTimeout(r, 200));
        serverSocket.end();
        await syncPromise2;
        clientSocket.destroy();
        serverSocket.destroy();
      }

      const countAfterSecond = (
        peerDb.prepare("SELECT count(*) AS n FROM contents").get() as { n: number }
      ).n;
      expect(countAfterSecond).toBe(1);
    });

    // Bug: peer's local db_version (own clock) is unrelated to the host's db_version.
    // If peer's localDbVersion >= host's db_version for a doc's initial columns (type/title),
    // but < the db_version of a later body edit, the peer would receive the body-only update
    // and never see the type/title — leaving type='' and title=NULL on the peer.
    // Fix: performInitialSync always sends dbVersion=0 (fullSync) to request ALL host data.
    // Bug: rows=0 after fullSync when host crsql_changes contains stale pre-migration-19
    // INTEGER-pk sentinel rows. These rows are ordered first (low db_version) in the
    // changeset. The first stmt.run() for a stale row throws inside db.transaction(),
    // which causes the whole transaction to roll back — all rows lost, applyChanges throws,
    // outer catch swallows it, onChangesReceived never fires → rows=0.
    // Fix: applyChanges wraps each stmt.run() in its own try-catch so stale rows are
    // skipped individually without aborting the whole batch.
    it("peer receives contents from host even when host crsql_changes has stale pre-migration INTEGER-pk entries (fullSync rows=0 bug)", async () => {
      const WS = "legacy-migration-ws";

      // Build a host db that mirrors the production state after migration 19 ran:
      // crsql_changes has OLD INTEGER-pk sentinel rows (db_version=low) from before the
      // migration, plus NEW UUID-pk rows (db_version=high) for the actual current data.
      const hostDb = new Database(":memory:");
      loadSqliteVec(hostDb);
      loadCrsqlite(hostDb);

      // Pre-migration schema: INTEGER pk on contents
      hostDb.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE workspaces (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
        CREATE TABLE features (
          id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, name TEXT NOT NULL,
          UNIQUE(workspace_id, name)
        );
        CREATE TABLE contents (
          id INTEGER NOT NULL PRIMARY KEY,
          type TEXT NOT NULL DEFAULT '',
          title TEXT,
          body TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE content_features (
          content_id INTEGER NOT NULL DEFAULT 0,
          feature_id INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (content_id, feature_id)
        );
        CREATE TABLE content_links (
          parent_id INTEGER NOT NULL DEFAULT 0,
          child_id  INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (parent_id, child_id)
        );
      `);

      // Register CRDT with INTEGER pks — creates INTEGER-pk entries in crsql_changes.
      hostDb.exec("SELECT crsql_as_crr('contents')");
      hostDb.exec("SELECT crsql_as_crr('content_features')");
      hostDb.exec("SELECT crsql_as_crr('content_links')");

      // Insert workspace and content in the INTEGER-pk era.
      hostDb.prepare("INSERT INTO workspaces (id, name) VALUES (?, ?)").run(1, WS);
      hostDb.prepare("INSERT INTO contents (id, type, title, body) VALUES (?, ?, ?, ?)").run(1, "spec", "Doc 1", "Body 1");
      hostDb.prepare("INSERT INTO contents (id, type, title, body) VALUES (?, ?, ?, ?)").run(2, "plan", "Doc 2", "Body 2");

      // Simulate migration 19: drop INTEGER-pk contents, recreate with UUID pk.
      // Crucially, the old INTEGER-pk crsql_changes entries are LEFT INTACT.
      hostDb.exec("PRAGMA foreign_keys = OFF");
      hostDb.exec(`
        BEGIN;
        CREATE TABLE _uuid_map (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);
        INSERT INTO _uuid_map (old_id, new_id) SELECT id, lower(hex(randomblob(16))) FROM contents;
        CREATE TABLE _contents_uuid (
          id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          type TEXT NOT NULL DEFAULT '',
          title TEXT,
          body TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO _contents_uuid (id, type, title, body, created_at, updated_at)
          SELECT m.new_id, c.type, c.title, c.body, c.created_at, c.updated_at
          FROM contents c JOIN _uuid_map m ON m.old_id = c.id;
        DROP TABLE contents;
        ALTER TABLE _contents_uuid RENAME TO contents;
        DROP TABLE IF EXISTS _uuid_map;
        COMMIT;
      `);
      hostDb.exec("PRAGMA foreign_keys = ON");

      // Re-register CRDT for the UUID-pk contents — adds new UUID-pk entries in crsql_changes.
      hostDb.exec("SELECT crsql_as_crr('contents')");
      hostDb.exec("SELECT crsql_as_crr('content_features')");
      hostDb.exec("SELECT crsql_as_crr('content_links')");

      // Verify the mixed state: both INTEGER-pk (low db_version) and UUID-pk (high db_version).
      const allVersions = (
        hostDb.prepare('SELECT db_version FROM crsql_changes WHERE "table" = ?').all("contents") as { db_version: number }[]
      ).map((r) => r.db_version);
      expect(Math.min(...allVersions)).toBeLessThan(Math.max(...allVersions));

      // Fresh peer db with current schema (all migrations run including 19, UUID pks).
      const peerDb = createCrsqlDb();
      // Insert the workspace so bootstrap features land correctly.
      peerDb.prepare("INSERT INTO workspaces (id, name) VALUES (?, ?)").run(1, WS);

      const { clientSocket, serverSocket } = await makeTcpPair();

      // Host sends ALL changes (including stale INTEGER-pk rows at the start of the changeset).
      handleSyncConnection(hostDb, WS, serverSocket as unknown as NodeJS.ReadWriteStream);
      // Peer uses fullSync=true → advertises dbVersion=0 → gets ALL rows from host.
      handleSyncConnection(peerDb, WS, clientSocket as unknown as NodeJS.ReadWriteStream, undefined, { fullSync: true });

      await new Promise((r) => setTimeout(r, 300));
      serverSocket.end();
      await new Promise((r) => setTimeout(r, 100));

      // Before fix: INTEGER-pk stale rows sent to peer → ghost rows created OR transaction
      // aborts → contents missing → count=0 (FAIL).
      // After fix: getChanges filters out INTEGER-pk rows at source → peer only receives
      // valid UUID-pk rows → count=2 (PASS).
      const count = (peerDb.prepare("SELECT count(*) AS n FROM contents").get() as { n: number }).n;
      expect(count).toBe(2);

      const docs = peerDb
        .prepare("SELECT type, title, body FROM contents ORDER BY type")
        .all() as { type: string; title: string | null; body: string }[];
      expect(docs.find((d) => d.type === "spec")).toMatchObject({ title: "Doc 1", body: "Body 1" });
      expect(docs.find((d) => d.type === "plan")).toMatchObject({ title: "Doc 2", body: "Body 2" });

      clientSocket.destroy();
      serverSocket.destroy();
    });

    it("peer receives correct type and title even when peer dbVersion > doc's initial db_version (split-version doc)", async () => {
      const WS = "split-version-ws";

      const hostDb = createCrsqlDb();
      createWorkspace(hostDb, WS);

      // Create a doc at a low db_version, then update its body at a higher db_version.
      // On the host: type+title land at db_version=N, body lands at db_version=N+K.
      hostDb.prepare("INSERT INTO contents (id, type, title, body) VALUES (?, ?, ?, ?)").run(
        "aabbccddeeff00112233445566778899",
        "spec",
        "The Real Title",
        "initial body",
      );
      const docVersion = (
        hostDb.prepare("SELECT MAX(db_version) AS v FROM crsql_changes").get() as { v: number }
      ).v;

      // Peer starts with its own CRDT data so that localDbVersion > docVersion.
      // This simulates the re-join scenario where a previous join landed some content.
      const peerDb = createCrsqlDb();
      seedPeerTeam(peerDb, WS);
      // Write content to the PEER db to bump its own localDbVersion above the host's docVersion.
      for (let i = 0; i <= docVersion; i++) {
        peerDb.prepare("INSERT INTO contents (type, body) VALUES (?, ?)").run("idea", "peer local doc " + i);
      }
      const peerDbVersion = (
        peerDb.prepare("SELECT MAX(db_version) AS v FROM crsql_changes").get() as { v: number }
      ).v;
      expect(peerDbVersion).toBeGreaterThan(docVersion); // confirm peer clock is ahead

      // Now update only body on the host — type/title stay at the OLD db_version.
      hostDb.prepare("UPDATE contents SET body = ? WHERE id = ?").run("updated body text", "aabbccddeeff00112233445566778899");
      const bodyVersion = (
        hostDb.prepare("SELECT MAX(db_version) AS v FROM crsql_changes").get() as { v: number }
      ).v;
      expect(bodyVersion).toBeGreaterThan(docVersion); // body is at a newer version than type/title

      // Without the fix (fullSync=false): host sends only db_version > peerDbVersion.
      // Since peerDbVersion > docVersion >= typeVersion, type+title would be skipped.
      // With the fix (fullSync=true): host sends ALL changes from db_version=0.

      const { performInitialSync } = await import("../../src/sync/initial.js");
      const syncPromise = performInitialSync(peerDb, WS, 5_000);

      await new Promise((r) => setTimeout(r, 20));
      expect(connectionHandler).not.toBeNull();

      const { clientSocket, serverSocket } = await makeTcpPair();
      handleSyncConnection(hostDb, WS, serverSocket as unknown as NodeJS.ReadWriteStream);
      connectionHandler!(clientSocket as unknown as NodeJS.ReadWriteStream);

      await new Promise((r) => setTimeout(r, 300));
      serverSocket.end();
      await syncPromise;

      // The peer should have received the host's doc with correct type and title.
      const synced = peerDb
        .prepare("SELECT type, title, body FROM contents WHERE id = ?")
        .get("aabbccddeeff00112233445566778899") as { type: string | null; title: string | null; body: string } | undefined;

      expect(synced).toBeDefined();
      expect(synced?.type).toBe("spec");       // must NOT be null/empty
      expect(synced?.title).toBe("The Real Title"); // must NOT be null
      expect(synced?.body).toBe("updated body text");

      clientSocket.destroy();
      serverSocket.destroy();
    });
  },
);
