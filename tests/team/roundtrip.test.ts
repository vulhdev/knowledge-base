import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { applySchema } from "../../src/db/schema.js";
import { isCrsqliteReady, loadCrsqlite } from "../../src/team/crsqlite.js";
import { getChanges, applyChanges } from "../../src/sync/changeset.js";

vi.mock("hyperswarm", () => ({
  default: vi.fn().mockImplementation(() => ({
    join: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  })),
}));

describe("invite code roundtrip", () => {
  it("buildInviteCode output can be parsed by parseInviteCode", async () => {
    const { buildInviteCode, parseInviteCode } = await import("../../src/team/invite.js");
    const { generateNoiseKeypair } = await import("../../src/team/generate.js");
    const kp = generateNoiseKeypair();
    const code = buildInviteCode(kp.publicKey, "my-workspace");
    const parsed = parseInviteCode(code);
    expect(parsed.hostPublicKey).toBe(kp.publicKey);
    expect(parsed.workspaceName).toBe("my-workspace");
  });

  it("deriveJoinTopic differs across workspace names", async () => {
    const { deriveJoinTopic } = await import("../../src/sync/join.js");
    const a = deriveJoinTopic("workspace-a");
    const b = deriveJoinTopic("workspace-b");
    expect(a.toString("hex")).not.toBe(b.toString("hex"));
  });

  it("sync topic and join topic are distinct for same workspace+secret", async () => {
    const { deriveJoinTopic } = await import("../../src/sync/join.js");
    const { deriveTopicBuffer } = await import("../../src/sync/peer.js");
    const secret = "a".repeat(64);
    const joinTopic = deriveJoinTopic("myws");
    const syncTopic = deriveTopicBuffer("myws", secret);
    expect(joinTopic.toString("hex")).not.toBe(syncTopic.toString("hex"));
  });
});

describe("team manifest after kick", () => {
  it("kicked peer no longer appears in manifest", async () => {
    const { createTestDb } = await import("../setup.js");
    const { kickPeer, getTeamManifest } = await import("../../src/team/kick.js");
    const db = createTestDb();
    db.prepare("INSERT INTO team_peers (public_key, display_name) VALUES (?, ?)").run("pk1", "Alice");
    db.prepare("INSERT INTO team_peers (public_key, display_name) VALUES (?, ?)").run("pk2", "Bob");
    kickPeer(db, "pk1");
    const manifest = getTeamManifest(db);
    const keys = manifest.peers.map((p) => p.publicKey);
    expect(keys).not.toContain("pk1");
    expect(keys).toContain("pk2");
  });

  it("firewall blocks kicked peer after kick", async () => {
    const { createTestDb } = await import("../setup.js");
    const { kickPeer } = await import("../../src/team/kick.js");
    const { createFirewall } = await import("../../src/sync/peer.js");
    const db = createTestDb();
    db.prepare("INSERT INTO team_peers (public_key, display_name) VALUES (?, ?)").run(
      "d".repeat(64), "Alice",
    );
    const firewallBefore = createFirewall(db);
    expect(firewallBefore(Buffer.from("d".repeat(64), "hex"))).toBe(false);

    kickPeer(db, "d".repeat(64));
    const firewallAfter = createFirewall(db);
    expect(firewallAfter(Buffer.from("d".repeat(64), "hex"))).toBe(true);
  });
});

describe.skipIf(!isCrsqliteReady())("CRSQLite UUID sync — no PK collision between peers", () => {
  function createCrsqlDb(): Database.Database {
    const db = new Database(":memory:");
    loadSqliteVec(db);
    loadCrsqlite(db);
    applySchema(db);
    return db;
  }

  it("two peers create 3 docs each; after bidirectional sync both have all 6 docs", () => {
    const dbA = createCrsqlDb();
    const dbB = createCrsqlDb();

    for (const body of ["doc-a1", "doc-a2", "doc-a3"]) {
      dbA.prepare("INSERT INTO contents (type, body) VALUES ('idea', ?)").run(body);
    }
    for (const body of ["doc-b1", "doc-b2", "doc-b3"]) {
      dbB.prepare("INSERT INTO contents (type, body) VALUES ('idea', ?)").run(body);
    }

    applyChanges(dbB, getChanges(dbA, 0));
    applyChanges(dbA, getChanges(dbB, 0));

    const countA = (dbA.prepare("SELECT count(*) AS n FROM contents").get() as { n: number }).n;
    const countB = (dbB.prepare("SELECT count(*) AS n FROM contents").get() as { n: number }).n;
    expect(countA).toBe(6);
    expect(countB).toBe(6);
  });

  it("same UUID doc on A and B has identical body after sync", () => {
    const dbA = createCrsqlDb();
    const dbB = createCrsqlDb();

    dbA.prepare("INSERT INTO contents (type, body) VALUES ('spec', 'canonical body')").run();
    const { id: uuidA } = dbA.prepare("SELECT id FROM contents LIMIT 1").get() as { id: string };
    expect(uuidA).toMatch(/^[0-9a-f]{32}$/);

    applyChanges(dbB, getChanges(dbA, 0));

    const rowB = dbB.prepare("SELECT id, body FROM contents WHERE id = ?").get(uuidA) as { id: string; body: string } | undefined;
    expect(rowB).toBeDefined();
    expect(rowB!.id).toBe(uuidA);
    expect(rowB!.body).toBe("canonical body");
  });

  it("same UUID has different rowid on each peer — rowid is a local surrogate, not shared", () => {
    const dbA = createCrsqlDb();
    const dbB = createCrsqlDb();

    // B inserts a row first so A's UUID lands at a later rowid on B
    dbB.prepare("INSERT INTO contents (type, body) VALUES ('idea', 'local-to-b')").run();

    dbA.prepare("INSERT INTO contents (type, body) VALUES ('idea', 'shared-doc')").run();
    const { id: uuidA, rowid: rowidInA } = dbA.prepare(
      "SELECT id, rowid FROM contents WHERE body = 'shared-doc'"
    ).get() as { id: string; rowid: number };

    applyChanges(dbB, getChanges(dbA, 0));

    const { rowid: rowidInB } = dbB.prepare(
      "SELECT rowid FROM contents WHERE id = ?"
    ).get(uuidA) as { rowid: number };

    expect(rowidInB).not.toBe(rowidInA);
  });
});
