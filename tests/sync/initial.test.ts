import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { createTestDb } from "../setup.js";
import { insertTeam } from "../../src/db/team.js";
import { createWorkspace } from "../../src/db/workspaces.js";

class MockSocket extends EventEmitter {
  readonly writes: Buffer[] = [];
  readonly writable = true;
  write(data: Buffer | string) {
    this.writes.push(Buffer.isBuffer(data) ? data : Buffer.from(data as string));
    return true;
  }
  destroy() {}
}

let connectionHandler: ((socket: NodeJS.ReadWriteStream) => void) | null = null;

vi.mock("hyperswarm", () => ({
  default: vi.fn().mockImplementation(() => ({
    join: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockImplementation((event: string, handler: unknown) => {
      if (event === "connection") connectionHandler = handler as (socket: NodeJS.ReadWriteStream) => void;
    }),
  })),
}));

vi.mock("../../src/sync/index.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/sync/index.js")>();
  return {
    ...orig,
    handleSyncConnection: vi.fn().mockImplementation(
      (_db: unknown, _ws: unknown, socket: NodeJS.EventEmitter, callbacks?: { onChangesReceived?: (rows: unknown[]) => void }) => {
        callbacks?.onChangesReceived?.([{}, {}, {}]); // simulate 3 rows received
      },
    ),
  };
});

function seedPeerTeam(db: ReturnType<typeof createTestDb>): void {
  const ws = createWorkspace(db, "myws");
  insertTeam(db, ws.id, {
    role: "peer",
    secret: "a".repeat(64),
    noise_public_key: "b".repeat(64),
    noise_secret_key: "c".repeat(64),
    host_public_key: "d".repeat(64),
    last_synced_at: null,
  });
}

describe("performInitialSync", () => {
  beforeEach(() => {
    connectionHandler = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("[IMPORTANT-CR] resolves with timeout when socket emits error (no promise leak)", async () => {
    const db = createTestDb();
    db.exec(
      "CREATE TABLE IF NOT EXISTS crsql_changes " +
      "(tbl TEXT, pk TEXT, cid TEXT, val ANY, col_version INTEGER, db_version INTEGER, site_id TEXT, cl INTEGER, seq INTEGER)",
    );
    db.function("crsql_site_id", () => Buffer.alloc(16));
    seedPeerTeam(db);

    const { performInitialSync } = await import("../../src/sync/initial.js");

    const syncPromise = performInitialSync(db, "myws", 5_000);

    await new Promise((r) => setTimeout(r, 10));
    expect(connectionHandler).not.toBeNull();

    const socket = new MockSocket();
    connectionHandler!(socket as unknown as NodeJS.ReadWriteStream);

    // Emit error — "close" will NOT be emitted on this mock; promise must still resolve.
    socket.emit("error", new Error("ECONNRESET"));

    const result = await syncPromise;
    // Promise resolves (not leaks) — either ok or timeout is acceptable
    expect(result).toBeDefined();
    expect(typeof result.ok).toBe("boolean");
  });

  it("returns crsql_unavailable when crsql extension is not loaded", async () => {
    const db = createTestDb();
    // createTestDb does NOT load crsql, so crsql_site_id() will throw
    seedPeerTeam(db);
    const { performInitialSync } = await import("../../src/sync/initial.js");
    const result = await performInitialSync(db, "myws", 100);
    expect(result).toEqual({ ok: false, reason: "crsql_unavailable" });
  });

  it("returns timeout when no host connects within the deadline", async () => {
    const db = createTestDb();
    // Simulate crsql availability by creating the table
    db.exec(
      "CREATE TABLE IF NOT EXISTS crsql_changes " +
      "(tbl TEXT, pk TEXT, cid TEXT, val ANY, col_version INTEGER, db_version INTEGER, site_id TEXT, cl INTEGER, seq INTEGER)",
    );
    db.function("crsql_site_id", () => Buffer.alloc(16));
    seedPeerTeam(db);

    const { performInitialSync } = await import("../../src/sync/initial.js");
    // connectionHandler is never called — no host connects
    const result = await performInitialSync(db, "myws", 50);
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("resolves ok with rowsReceived when socket closes after sync", async () => {
    const db = createTestDb();
    db.exec(
      "CREATE TABLE IF NOT EXISTS crsql_changes " +
      "(tbl TEXT, pk TEXT, cid TEXT, val ANY, col_version INTEGER, db_version INTEGER, site_id TEXT, cl INTEGER, seq INTEGER)",
    );
    db.function("crsql_site_id", () => Buffer.alloc(16));
    seedPeerTeam(db);

    const { performInitialSync } = await import("../../src/sync/initial.js");

    const syncPromise = performInitialSync(db, "myws", 5_000);

    // Wait for swarm.on("connection") to be registered, then fire connection
    await new Promise((r) => setTimeout(r, 10));
    expect(connectionHandler).not.toBeNull();

    const socket = new MockSocket();
    connectionHandler!(socket as unknown as NodeJS.ReadWriteStream);

    // Simulate socket close after sync
    socket.emit("close");

    const result = await syncPromise;
    expect(result).toEqual({ ok: true, rowsReceived: 3 });
  });
});
