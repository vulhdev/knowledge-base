import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "../setup.js";
import type Database from "better-sqlite3";

vi.mock("hyperswarm", () => {
  return {
    default: vi.fn().mockImplementation((opts: { firewall?: (key: Buffer) => boolean }) => ({
      _firewall: opts?.firewall,
      join: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    })),
  };
});

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

const MOCK_SETTINGS = {
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

describe("createFirewall", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("blocks unknown peers (not in team_peers)", async () => {
    const { createFirewall } = await import("../../src/sync/peer.js");
    const firewall = createFirewall(db);
    const blocked = firewall(Buffer.from("d".repeat(64), "hex"));
    expect(blocked).toBe(true);
  });

  it("allows active peers", async () => {
    const { createFirewall } = await import("../../src/sync/peer.js");
    db.prepare("INSERT INTO team_peers (public_key, display_name) VALUES (?, ?)").run(
      "d".repeat(64), "Alice",
    );
    const firewall = createFirewall(db);
    const blocked = firewall(Buffer.from("d".repeat(64), "hex"));
    expect(blocked).toBe(false);
  });

  it("blocks inactive peers", async () => {
    const { createFirewall } = await import("../../src/sync/peer.js");
    db.prepare("INSERT INTO team_peers (public_key, display_name, is_active) VALUES (?, ?, 0)").run(
      "d".repeat(64), "Alice",
    );
    const firewall = createFirewall(db);
    const blocked = firewall(Buffer.from("d".repeat(64), "hex"));
    expect(blocked).toBe(true);
  });
});

describe("deriveTopicBuffer", () => {
  it("returns a 32-byte Buffer", async () => {
    const { deriveTopicBuffer } = await import("../../src/sync/peer.js");
    const buf = deriveTopicBuffer("myws", "a".repeat(64));
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(32);
  });

  it("is deterministic", async () => {
    const { deriveTopicBuffer } = await import("../../src/sync/peer.js");
    const a = deriveTopicBuffer("ws", "secret");
    const b = deriveTopicBuffer("ws", "secret");
    expect(a.toString("hex")).toBe(b.toString("hex"));
  });

  it("differs for different workspace names", async () => {
    const { deriveTopicBuffer } = await import("../../src/sync/peer.js");
    const a = deriveTopicBuffer("ws1", "secret");
    const b = deriveTopicBuffer("ws2", "secret");
    expect(a.toString("hex")).not.toBe(b.toString("hex"));
  });

  it("differs for different secrets", async () => {
    const { deriveTopicBuffer } = await import("../../src/sync/peer.js");
    const a = deriveTopicBuffer("ws", "a".repeat(64));
    const b = deriveTopicBuffer("ws", "b".repeat(64));
    expect(a.toString("hex")).not.toBe(b.toString("hex"));
  });
});

describe("createSwarm", () => {
  let db: Database.Database;
  beforeEach(async () => {
    db = createTestDb();
    vi.resetModules();
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(MOCK_SETTINGS));
  });

  it("calls Hyperswarm constructor with firewall and keyPair", async () => {
    const Hyperswarm = (await import("hyperswarm")).default;
    const { createSwarm } = await import("../../src/sync/peer.js");
    createSwarm(db, "myws");
    expect(Hyperswarm).toHaveBeenCalledWith(
      expect.objectContaining({
        keyPair: expect.objectContaining({
          publicKey: expect.any(Buffer),
          secretKey: expect.any(Buffer),
        }),
        firewall: expect.any(Function),
      }),
    );
  });

  it("calls swarm.join with the topic buffer", async () => {
    const Hyperswarm = (await import("hyperswarm")).default;
    const { createSwarm } = await import("../../src/sync/peer.js");
    createSwarm(db, "myws");
    const swarmInstance = vi.mocked(Hyperswarm).mock.results[0].value;
    expect(swarmInstance.join).toHaveBeenCalledWith(expect.any(Buffer));
  });

  it("throws when workspace has no team config", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ db_path: "/db", model_cache_dir: "/m" }),
    );
    const { createSwarm } = await import("../../src/sync/peer.js");
    expect(() => createSwarm(db, "myws")).toThrow(/no team config/i);
  });
});
