import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { loadCrsqlite, isCrsqliteReady } from "../../src/team/crsqlite.js";

vi.mock("../../src/sync/join.js", () => ({
  handleJoinRequest: vi.fn().mockResolvedValue({ accepted: true, secret: "s".repeat(64) }),
  deriveJoinTopic: vi.fn().mockReturnValue(Buffer.alloc(32)),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

class MockSocket extends EventEmitter {
  readonly writes: Buffer[] = [];
  writable = true;
  write(data: Buffer | string) {
    if (!this.writable) return false;
    this.writes.push(Buffer.isBuffer(data) ? data : Buffer.from(data as string));
    return true;
  }
  destroy() {}
}

function makeMockDb(dbVersion = 0, extraChanges: unknown[] = []): Database.Database {
  return {
    prepare: (sql: string) => {
      if (sql.includes("MAX(db_version)")) {
        return { get: () => ({ v: dbVersion }), all: () => [] };
      }
      // getChanges query
      if (sql.includes("crsql_changes WHERE db_version")) {
        return { get: () => null, all: (_sinceVersion: number) => extraChanges };
      }
      // getBootstrapFeatures
      return { get: () => null, all: () => [] };
    },
  } as unknown as Database.Database;
}

// Simulate peer sending its handshake so handleSyncConnection completes setup
function sendPeerHandshake(socket: MockSocket, peerDbVersion = 0): void {
  process.nextTick(() => {
    socket.emit("data", Buffer.from(JSON.stringify({ v: 1, dbVersion: peerDbVersion }) + "\n"));
  });
}

// ── Task 1: handleSyncConnection returns { pushDelta } ────────────────────────

describe("handleSyncConnection return value", () => {
  it("returns an object with a pushDelta function", async () => {
    const { handleSyncConnection } = await import("../../src/sync/index.js");
    const socket = new MockSocket();
    const db = makeMockDb(3);

    const result = handleSyncConnection(db, "test-ws", socket as unknown as NodeJS.ReadWriteStream);

    expect(result).toBeDefined();
    expect(result).not.toBeUndefined();
    expect(typeof (result as { pushDelta?: unknown }).pushDelta).toBe("function");
  });

  it("pushDelta sends encoded delta to socket after new changes", async () => {
    const { handleSyncConnection } = await import("../../src/sync/index.js");
    const { encodeChangeset, decodeChangeset } = await import("../../src/sync/changeset.js");

    const INITIAL_VERSION = 3;
    const NEW_ROW = {
      tbl: "contents", pk: "01000000", cid: "body", val: "hello",
      col_version: 1, db_version: 4, site_id: "aa", cl: 1, seq: 0,
    };

    // DB returns no extra changes initially, then returns NEW_ROW
    let returnNewRow = false;
    const db = {
      prepare: (sql: string) => {
        if (sql.includes("MAX(db_version)")) return { get: () => ({ v: INITIAL_VERSION }), all: () => [] };
        if (sql.includes("crsql_changes WHERE db_version")) {
          return { get: () => null, all: () => (returnNewRow ? [NEW_ROW] : []) };
        }
        return { get: () => null, all: () => [] };
      },
    } as unknown as Database.Database;

    const socket = new MockSocket();
    const result = handleSyncConnection(db, "test-ws", socket as unknown as NodeJS.ReadWriteStream);
    const handle = result as { pushDelta: () => void };

    // Complete the handshake so initial changeset is sent
    await new Promise<void>((resolve) => {
      process.nextTick(() => {
        socket.emit("data", Buffer.from(JSON.stringify({ v: 1, dbVersion: 5 }) + "\n"));
        resolve();
      });
    });
    await new Promise<void>((r) => process.nextTick(r));

    const writesBefore = socket.writes.length;

    // Simulate new write to DB
    returnNewRow = true;
    handle.pushDelta();

    // Should have written more bytes
    expect(socket.writes.length).toBeGreaterThan(writesBefore);

    // Decode the last written frame (4-byte header + data)
    const lastWrite = socket.writes[socket.writes.length - 1];
    const size = lastWrite.readUInt32BE(0);
    const rows = decodeChangeset(lastWrite.slice(4, 4 + size));
    expect(rows).toHaveLength(1);
    expect(rows[0].tbl).toBe("contents");
  });

  it("pushDelta is no-op when no new changes", async () => {
    const { handleSyncConnection } = await import("../../src/sync/index.js");
    const db = makeMockDb(3); // always returns empty changes
    const socket = new MockSocket();
    const result = handleSyncConnection(db, "test-ws", socket as unknown as NodeJS.ReadWriteStream);
    const handle = result as { pushDelta: () => void };

    await new Promise<void>((r) => process.nextTick(r));
    const writesBefore = socket.writes.length;

    handle.pushDelta(); // no new changes → no write

    expect(socket.writes.length).toBe(writesBefore);
  });

  it("pushDelta does not write when socket is not writable", async () => {
    const { handleSyncConnection } = await import("../../src/sync/index.js");
    const NEW_ROW = {
      tbl: "contents", pk: "01", cid: "body", val: "x",
      col_version: 1, db_version: 4, site_id: "aa", cl: 1, seq: 0,
    };
    const db = makeMockDb(3, [NEW_ROW]);
    const socket = new MockSocket();
    const result = handleSyncConnection(db, "test-ws", socket as unknown as NodeJS.ReadWriteStream);
    const handle = result as { pushDelta: () => void };

    await new Promise<void>((r) => process.nextTick(r));

    socket.writable = false;
    const writesBefore = socket.writes.length;

    expect(() => handle.pushDelta()).not.toThrow();
    expect(socket.writes.length).toBe(writesBefore);
  });

  it("pushDelta increments lastSentDbVersion — second push only sends new rows", async () => {
    const { handleSyncConnection } = await import("../../src/sync/index.js");
    const { decodeChangeset } = await import("../../src/sync/changeset.js");

    const ROW_V4 = { tbl: "contents", pk: "01", cid: "body", val: "first", col_version: 1, db_version: 4, site_id: "aa", cl: 1, seq: 0 };
    const ROW_V5 = { tbl: "contents", pk: "02", cid: "body", val: "second", col_version: 1, db_version: 5, site_id: "aa", cl: 1, seq: 0 };

    let phase = 0; // 0=initial, 1=first push, 2=second push
    const db = {
      prepare: (sql: string) => {
        if (sql.includes("MAX(db_version)")) return { get: () => ({ v: 3 }), all: () => [] };
        if (sql.includes("crsql_changes WHERE db_version")) {
          return {
            get: () => null,
            all: (since: number) => {
              if (phase === 1 && since === 3) return [ROW_V4];
              if (phase === 2 && since === 4) return [ROW_V5];
              return [];
            },
          };
        }
        return { get: () => null, all: () => [] };
      },
    } as unknown as Database.Database;

    const socket = new MockSocket();
    const result = handleSyncConnection(db, "test-ws", socket as unknown as NodeJS.ReadWriteStream);
    const handle = result as { pushDelta: () => void };
    await new Promise<void>((r) => process.nextTick(r));

    // First push — sends ROW_V4
    phase = 1;
    handle.pushDelta();
    expect(socket.writes.length).toBeGreaterThanOrEqual(1);
    const firstPushWrite = socket.writes[socket.writes.length - 1];
    const firstRows = decodeChangeset(firstPushWrite.slice(4));
    expect(firstRows).toHaveLength(1);
    expect(firstRows[0].db_version).toBe(4);

    // Second push — only sends ROW_V5 (since=4, not since=3)
    phase = 2;
    handle.pushDelta();
    const secondPushWrite = socket.writes[socket.writes.length - 1];
    const secondRows = decodeChangeset(secondPushWrite.slice(4));
    expect(secondRows).toHaveLength(1);
    expect(secondRows[0].db_version).toBe(5);
  });
});

// ── Task 3: handleJoinConnection calls onSyncStarted ─────────────────────────

describe("handleJoinConnection onSyncStarted", () => {
  it("calls onSyncStarted with { pushDelta } when join is accepted", async () => {
    const { handleJoinConnection } = await import("../../src/sync/index.js");

    const NOISE_KEY = Buffer.from("a".repeat(64), "hex");

    // handleJoinRequest is mocked to return accepted:true — DB only needs to serve handleSyncConnection
    const db = makeMockDb(0);

    const socket = new MockSocket();
    const onSyncStarted = vi.fn();

    handleJoinConnection(db, "test-ws", socket as unknown as NodeJS.ReadWriteStream, NOISE_KEY, {
      onSyncStarted,
    });

    // Emit a valid join_request from the peer — peerPublicKey must match NOISE_KEY hex
    socket.emit("data", Buffer.from(
      JSON.stringify({
        type: "join_request",
        githubToken: "gho_test",
        peerPublicKey: "a".repeat(64),
        githubUsername: "alice",
      }) + "\n",
    ));

    // handleJoinRequest is async — wait for the promise to resolve
    await new Promise<void>((r) => setTimeout(r, 20));

    // onSyncStarted must have been called with an object containing pushDelta
    expect(onSyncStarted).toHaveBeenCalledOnce();
    const arg = onSyncStarted.mock.calls[0][0] as { pushDelta?: unknown };
    expect(typeof arg.pushDelta).toBe("function");
  });
});

// ── Task 2: pusher registry ───────────────────────────────────────────────────

describe("pusher registry", () => {
  beforeEach(async () => {
    // Reset module state between tests
    vi.resetModules();
  });

  it("registerPusher calls the push fn when pushToWorkspace is invoked", async () => {
    const { registerPusher, pushToWorkspace } = await import("../../src/sync/push.js");
    const fn = vi.fn();
    registerPusher("ws-a", fn);
    pushToWorkspace("ws-a");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("unregister removes the pusher", async () => {
    const { registerPusher, pushToWorkspace } = await import("../../src/sync/push.js");
    const fn = vi.fn();
    const unregister = registerPusher("ws-b", fn);
    unregister();
    pushToWorkspace("ws-b");
    expect(fn).not.toHaveBeenCalled();
  });

  it("pushToAllWorkspaces calls all registered pushers across workspaces", async () => {
    const { registerPusher, pushToAllWorkspaces } = await import("../../src/sync/push.js");
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    registerPusher("ws-c", fn1);
    registerPusher("ws-d", fn2);
    pushToAllWorkspaces();
    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
  });

  it("unregister on empty set does not crash", async () => {
    const { registerPusher } = await import("../../src/sync/push.js");
    const fn = vi.fn();
    const unregister = registerPusher("ws-e", fn);
    unregister();
    expect(() => unregister()).not.toThrow(); // double unregister safe
  });
});

// ── Task 5: integration tests with real DBs ───────────────────────────────────

describe("push-on-write integration", () => {
  it.skipIf(!isCrsqliteReady())("pushDelta sends real CRSQLite rows written after sync handshake", async () => {
    const { handleSyncConnection } = await import("../../src/sync/index.js");
    const { decodeChangeset } = await import("../../src/sync/changeset.js");

    // Load CRSQLite into a minimal in-memory DB (not createTestDb — that has unique indices
    // on contents which CRSQLite forbids when calling crsql_as_crr)
    const Database = (await import("better-sqlite3")).default;
    const hostDb = new Database(":memory:");
    loadCrsqlite(hostDb);
    // Minimal contents table — no unique indices except PK so crsql_as_crr succeeds
    hostDb.exec("CREATE TABLE contents (id TEXT PRIMARY KEY NOT NULL, type TEXT DEFAULT '', body TEXT DEFAULT '')");
    hostDb.exec("SELECT crsql_as_crr('contents')");

    const socket = new MockSocket();
    const { pushDelta } = handleSyncConnection(hostDb, "test-ws", socket as unknown as NodeJS.ReadWriteStream);

    // Simulate peer handshake so peerVersion is set and initial changeset is sent
    await new Promise<void>((resolve) => {
      process.nextTick(() => {
        socket.emit("data", Buffer.from(JSON.stringify({ v: 1, dbVersion: 0 }) + "\n"));
        resolve();
      });
    });
    await new Promise<void>((r) => process.nextTick(r));

    // Record writes so far (handshake + initial changeset; contents is a CRR table, currently empty)
    const writesBefore = socket.writes.length;

    // Write a new content row (CRR table → tracked by crsql_changes)
    hostDb.prepare("INSERT INTO contents (id, type, body) VALUES ('c1', 'idea', 'hello push-on-write')").run();

    // pushDelta should send the new CRSQLite changeset
    pushDelta();

    expect(socket.writes.length).toBeGreaterThan(writesBefore);

    // Verify the last frame decodes to real changeset rows
    const lastWrite = socket.writes[socket.writes.length - 1];
    const size = lastWrite.readUInt32BE(0);
    const rows = decodeChangeset(lastWrite.slice(4, 4 + size));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some(r => r.tbl === "contents")).toBe(true);
  });

  it("unregister stops pushes after socket close", async () => {
    const { registerPusher, pushToWorkspace } = await import("../../src/sync/push.js");

    const pushFn = vi.fn();
    const unregister = registerPusher("integration-ws", pushFn);

    pushToWorkspace("integration-ws");
    expect(pushFn).toHaveBeenCalledOnce();

    // Simulate close
    unregister();

    pushFn.mockClear();
    pushToWorkspace("integration-ws");
    expect(pushFn).not.toHaveBeenCalled();
  });
});
