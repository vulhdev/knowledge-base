import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { createTestDb } from "../setup.js";

class MockSocket extends EventEmitter {
  readonly writes: Buffer[] = [];
  readonly writable = true;
  write(data: Buffer | string) {
    this.writes.push(Buffer.isBuffer(data) ? data : Buffer.from(data as string));
    return true;
  }
  destroy() {}
}

vi.mock("hyperswarm", () => ({
  default: vi.fn().mockImplementation(() => ({
    join: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  })),
}));

vi.mock("../../src/sync/changeset.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/sync/changeset.js")>();
  return { ...orig, getChanges: vi.fn().mockReturnValue([]), applyChanges: vi.fn() };
});

vi.mock("../../src/sync/rebuild.js", () => ({ rebuildFts: vi.fn() }));

vi.mock("node:os", () => ({ homedir: vi.fn().mockReturnValue("/test/home") }));
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  chmodSync: vi.fn(),
  renameSync: vi.fn(),
  copyFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

const HOST_SETTINGS = {
  db_path: "/db",
  model_cache_dir: "/m",
  workspaces: {
    myws: {
      team: {
        role: "host" as const,
        secret: "a".repeat(64),
        noise_keypair: { publicKey: "b".repeat(64), secretKey: "c".repeat(64) },
      },
    },
  },
};

describe("startSync", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(HOST_SETTINGS));
  });

  it("returns a handle with a destroy function", async () => {
    const db = createTestDb();
    const { startSync } = await import("../../src/sync/index.js");
    const handle = startSync(db, "myws");
    expect(typeof handle.destroy).toBe("function");
    await handle.destroy();
  });

  it("creates a Hyperswarm instance", async () => {
    const db = createTestDb();
    const Hyperswarm = (await import("hyperswarm")).default;
    const { startSync } = await import("../../src/sync/index.js");
    startSync(db, "myws");
    expect(Hyperswarm).toHaveBeenCalled();
  });

  it("registers a connection event listener on the swarm", async () => {
    const db = createTestDb();
    const Hyperswarm = (await import("hyperswarm")).default;
    const { startSync } = await import("../../src/sync/index.js");
    startSync(db, "myws");
    const swarmInstance = vi.mocked(Hyperswarm).mock.results[0].value;
    expect(swarmInstance.on).toHaveBeenCalledWith("connection", expect.any(Function));
  });

  it("writes last_synced_at to settings via recordSyncTimestamp", async () => {
    const { writeFileSync, readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(HOST_SETTINGS));

    const { recordSyncTimestamp } = await import("../../src/sync/index.js");
    recordSyncTimestamp("myws");

    const calls = vi.mocked(writeFileSync).mock.calls;
    const settingsCall = calls.find(([p, body]) =>
      typeof p === "string" && p.includes("settings.json") && String(body).includes("last_synced_at")
    );
    expect(settingsCall).toBeDefined();
  });

  it("throws when workspace has no team config", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ db_path: "/db", model_cache_dir: "/m" }),
    );
    const db = createTestDb();
    const { startSync } = await import("../../src/sync/index.js");
    expect(() => startSync(db, "myws")).toThrow(/no team config/i);
  });
});

function createSyncTestDb() {
  const db = createTestDb();
  db.exec(
    "CREATE TABLE crsql_changes " +
    "(tbl TEXT, pk TEXT, cid TEXT, val ANY, col_version INTEGER, db_version INTEGER, site_id TEXT)",
  );
  return db;
}

describe("handleSyncConnection — buf framing", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(HOST_SETTINGS));
  });

  it("size === 0 keep-alive: buf advances so next valid frame is processed", async () => {
    const db = createSyncTestDb();
    const { applyChanges, encodeChangeset } = await import("../../src/sync/changeset.js");
    const { handleSyncConnection } = await import("../../src/sync/index.js");

    const socket = new MockSocket();
    handleSyncConnection(db, "myws", socket as unknown as NodeJS.ReadWriteStream);

    // Complete handshake
    socket.emit("data", Buffer.from(JSON.stringify({ v: 1, dbVersion: 0 }) + "\n"));

    // Send a zero-size keep-alive
    const zeroHeader = Buffer.allocUnsafe(4);
    zeroHeader.writeUInt32BE(0, 0);
    socket.emit("data", zeroHeader);

    // Send a valid frame right after
    const encoded = encodeChangeset([]);
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(encoded.length, 0);
    socket.emit("data", Buffer.concat([header, encoded]));

    expect(vi.mocked(applyChanges)).toHaveBeenCalledTimes(1);
  });

  it("consumed changeset bytes do not get re-applied on next data event", async () => {
    const db = createSyncTestDb();
    const { applyChanges, encodeChangeset } = await import("../../src/sync/changeset.js");
    const { handleSyncConnection } = await import("../../src/sync/index.js");

    const socket = new MockSocket();
    handleSyncConnection(db, "myws", socket as unknown as NodeJS.ReadWriteStream);

    // Complete handshake
    socket.emit("data", Buffer.from(JSON.stringify({ v: 1, dbVersion: 0 }) + "\n"));

    // Send a valid changeset frame
    const encoded = encodeChangeset([]);
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(encoded.length, 0);
    socket.emit("data", Buffer.concat([header, encoded]));

    // Capture call count immediately after processing the frame
    const countAfterFrame = vi.mocked(applyChanges).mock.calls.length;
    expect(countAfterFrame).toBeGreaterThanOrEqual(1);

    // Emit trailing byte — must not cause another applyChanges call
    socket.emit("data", Buffer.from([0x01]));
    expect(vi.mocked(applyChanges).mock.calls.length).toBe(countAfterFrame);
  });
});
