import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "../setup.js";
import type Database from "better-sqlite3";
import { insertTeam } from "../../src/db/team.js";
import { createWorkspace } from "../../src/db/workspaces.js";

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

describe("createFirewall", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("allows unknown peers (not in team_peers) — they may be joining", async () => {
    const { createFirewall } = await import("../../src/sync/peer.js");
    const firewall = createFirewall(db);
    const blocked = firewall(Buffer.from("d".repeat(64), "hex"));
    expect(blocked).toBe(false);
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

  beforeEach(() => {
    db = createTestDb();
    const ws = createWorkspace(db, "myws");
    insertTeam(db, ws.id, {
      role: "host",
      secret: "a".repeat(64),
      noise_public_key: "b".repeat(64),
      noise_secret_key: "c".repeat(64),
      host_public_key: null,
      last_synced_at: null,
    });
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
    const emptyDb = createTestDb();
    createWorkspace(emptyDb, "myws");
    const { createSwarm } = await import("../../src/sync/peer.js");
    expect(() => createSwarm(emptyDb, "myws")).toThrow(/no team config/i);
  });
});
