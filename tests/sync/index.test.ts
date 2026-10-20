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

vi.mock("../../src/sync/join.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/sync/join.js")>();
  return {
    ...orig,
    handleJoinRequest: vi.fn().mockResolvedValue({ accepted: true, secret: "s".repeat(64) }),
  };
});

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

describe("handleJoinConnection — security guards", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(HOST_SETTINGS));
  });

  it("rejects join_request when wire peerPublicKey differs from Noise transport key", async () => {
    const noiseKey = Buffer.from("a".repeat(64), "hex");
    const db = createTestDb();
    const { handleJoinConnection } = await import("../../src/sync/index.js");

    const socket = new MockSocket();
    handleJoinConnection(db, "myws", socket as unknown as NodeJS.ReadWriteStream, noiseKey);

    const msg = JSON.stringify({
      type: "join_request",
      githubToken: "gho_abc",
      peerPublicKey: "b".repeat(64), // different from noiseKey's hex
      githubUsername: "vulhdev",
    });
    socket.emit("data", Buffer.from(msg + "\n"));

    await new Promise((r) => setTimeout(r, 10));
    const response = JSON.parse(socket.writes.at(-1)!.toString().trim()) as { accepted: boolean; reason?: string };
    expect(response.accepted).toBe(false);
    expect(response.reason).toMatch(/public key mismatch/i);
  });

  it("does not reject join_request when wire peerPublicKey matches Noise transport key", async () => {
    const noiseKeyHex = "a".repeat(64);
    const noiseKey = Buffer.from(noiseKeyHex, "hex");
    const db = createTestDb();
    const { handleJoinConnection } = await import("../../src/sync/index.js");

    const socket = new MockSocket();
    handleJoinConnection(db, "myws", socket as unknown as NodeJS.ReadWriteStream, noiseKey);

    const msg = JSON.stringify({
      type: "join_request",
      githubToken: "gho_abc",
      peerPublicKey: noiseKeyHex,
      githubUsername: "vulhdev",
    });
    socket.emit("data", Buffer.from(msg + "\n"));

    await new Promise((r) => setTimeout(r, 20));
    const lastWrite = socket.writes.at(-1);
    expect(lastWrite).toBeDefined();
    const response = JSON.parse(lastWrite!.toString().trim()) as { reason?: string };
    expect(response.reason ?? "").not.toMatch(/public key mismatch/i);
  });

  it("ignores a second join_request on the same socket (handled guard)", async () => {
    const noiseKeyHex = "a".repeat(64);
    const noiseKey = Buffer.from(noiseKeyHex, "hex");
    const db = createTestDb();
    const { handleJoinConnection } = await import("../../src/sync/index.js");

    const socket = new MockSocket();
    handleJoinConnection(db, "myws", socket as unknown as NodeJS.ReadWriteStream, noiseKey);

    const msg = JSON.stringify({
      type: "join_request",
      githubToken: "gho_abc",
      peerPublicKey: noiseKeyHex,
    }) + "\n";

    // Two messages in one data event — only one response should be sent
    socket.emit("data", Buffer.from(msg + msg));

    await new Promise((r) => setTimeout(r, 30));
    expect(socket.writes).toHaveLength(1);
  });
});

describe("handleSyncConnection — buf framing", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(HOST_SETTINGS));
  });

  it("oversized header closes the socket immediately", async () => {
    const db = createSyncTestDb();
    const { MAX_CHANGESET_BYTES } = await import("../../src/sync/changeset.js");
    const { handleSyncConnection } = await import("../../src/sync/index.js");

    const socket = new MockSocket();
    let destroyed = false;
    socket.destroy = () => { destroyed = true; };
    handleSyncConnection(db, "myws", socket as unknown as NodeJS.ReadWriteStream);

    // Complete handshake
    socket.emit("data", Buffer.from(JSON.stringify({ v: 1, dbVersion: 0 }) + "\n"));

    // Send a header claiming MAX+1 bytes
    const oversizedHeader = Buffer.allocUnsafe(4);
    oversizedHeader.writeUInt32BE(MAX_CHANGESET_BYTES + 1, 0);
    socket.emit("data", oversizedHeader);

    expect(destroyed).toBe(true);
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
