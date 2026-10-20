import { describe, it, expect } from "vitest";

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
