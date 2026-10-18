import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "../setup.js";
import type Database from "better-sqlite3";

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

const HOST_CONFIG = {
  role: "host" as const,
  secret: "a".repeat(64),
  noise_keypair: { publicKey: "b".repeat(64), secretKey: "c".repeat(64) },
  pending_token: "d".repeat(32),
};

describe("handleJoinRequest (host side)", () => {
  let db: Database.Database;
  beforeEach(async () => {
    db = createTestDb();
    vi.resetModules();
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        db_path: "/db",
        model_cache_dir: "/m",
        workspaces: { myws: { team: HOST_CONFIG } },
      }),
    );
  });

  it("returns accepted=true when pending_token matches", async () => {
    const { handleJoinRequest } = await import("../../src/sync/join.js");
    const result = handleJoinRequest(db, "myws", {
      pendingToken: "d".repeat(32),
      displayName: "Alice",
      peerPublicKey: "e".repeat(64),
    });
    expect(result.accepted).toBe(true);
  });

  it("returns the workspace secret on acceptance", async () => {
    const { handleJoinRequest } = await import("../../src/sync/join.js");
    const result = handleJoinRequest(db, "myws", {
      pendingToken: "d".repeat(32),
      displayName: "Alice",
      peerPublicKey: "e".repeat(64),
    });
    expect((result as { accepted: true; secret: string }).secret).toBe("a".repeat(64));
  });

  it("inserts the new peer into team_peers on acceptance", async () => {
    const { handleJoinRequest } = await import("../../src/sync/join.js");
    handleJoinRequest(db, "myws", {
      pendingToken: "d".repeat(32),
      displayName: "Alice",
      peerPublicKey: "e".repeat(64),
    });
    const row = db.prepare("SELECT display_name FROM team_peers WHERE public_key = ?").get("e".repeat(64)) as
      | { display_name: string }
      | undefined;
    expect(row?.display_name).toBe("Alice");
  });

  it("clears pending_token in settings.json after acceptance", async () => {
    const { writeFileSync } = await import("node:fs");
    const { handleJoinRequest } = await import("../../src/sync/join.js");
    handleJoinRequest(db, "myws", {
      pendingToken: "d".repeat(32),
      displayName: "Alice",
      peerPublicKey: "e".repeat(64),
    });
    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written.workspaces.myws.team.pending_token).toBeUndefined();
  });

  it("returns accepted=false when pending_token does not match", async () => {
    const { handleJoinRequest } = await import("../../src/sync/join.js");
    const result = handleJoinRequest(db, "myws", {
      pendingToken: "f".repeat(32),
      displayName: "Alice",
      peerPublicKey: "e".repeat(64),
    });
    expect(result.accepted).toBe(false);
  });

  it("returns accepted=false when no pending_token is set (already used)", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        db_path: "/db",
        model_cache_dir: "/m",
        workspaces: {
          myws: { team: { ...HOST_CONFIG, pending_token: undefined } },
        },
      }),
    );
    const { handleJoinRequest } = await import("../../src/sync/join.js");
    const result = handleJoinRequest(db, "myws", {
      pendingToken: "d".repeat(32),
      displayName: "Alice",
      peerPublicKey: "e".repeat(64),
    });
    expect(result.accepted).toBe(false);
  });
});

describe("deriveJoinTopic", () => {
  it("returns a 32-byte Buffer distinct from the sync topic", async () => {
    const { deriveJoinTopic } = await import("../../src/sync/join.js");
    const { deriveTopicBuffer } = await import("../../src/sync/peer.js");
    const joinTopic = deriveJoinTopic("myws");
    const syncTopic = deriveTopicBuffer("myws", "a".repeat(64));
    expect(joinTopic.length).toBe(32);
    expect(joinTopic.toString("hex")).not.toBe(syncTopic.toString("hex"));
  });

  it("is deterministic", async () => {
    const { deriveJoinTopic } = await import("../../src/sync/join.js");
    expect(deriveJoinTopic("ws").toString("hex")).toBe(deriveJoinTopic("ws").toString("hex"));
  });
});
