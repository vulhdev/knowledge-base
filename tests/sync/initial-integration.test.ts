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
  },
);
