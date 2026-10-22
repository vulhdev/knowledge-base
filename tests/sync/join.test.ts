import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { createTestDb } from "../setup.js";
import type Database from "better-sqlite3";
import { insertTeam, addInvite } from "../../src/db/team.js";
import { createWorkspace } from "../../src/db/workspaces.js";

vi.mock("../../src/team/github.js", () => ({
  getGitHubUsername: vi.fn(),
}));

vi.mock("../../src/sync/version.js", () => ({
  HOST_VERSION: "1.17.0",
  parseMajorMinor: (v: string) => v.split(".").slice(0, 2).join("."),
}));

const NOW_ISO = "2026-10-20T12:00:00.000Z";
const RECENT_ISO = "2026-10-20T11:00:00.000Z"; // 1h ago — within TTL
const EXPIRED_ISO = "2026-10-18T12:00:00.000Z"; // 48h ago — expired

function seedJoinSetup(
  db: Database.Database,
  opts: { invitedAt?: string; inviteUsername?: string } = {},
): { wsId: number } {
  const ws = createWorkspace(db, "myws");
  insertTeam(db, ws.id, {
    role: "host",
    secret: "a".repeat(64),
    noise_public_key: "b".repeat(64),
    noise_secret_key: "c".repeat(64),
    host_public_key: null,
    last_synced_at: null,
  });
  const username = opts.inviteUsername ?? "vulhdev";
  addInvite(db, ws.id, username);
  if (opts.invitedAt) {
    db.prepare("UPDATE workspace_invites SET invited_at = ? WHERE workspace_id = ? AND github_username = ?")
      .run(opts.invitedAt, ws.id, username);
  }
  return { wsId: ws.id };
}

describe("handleJoinRequest (host side)", () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = createTestDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
    vi.resetModules();
    seedJoinSetup(db);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns accepted=true when GitHub token resolves to an invited username", async () => {
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const result = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
      appVersion: "1.17.0",
    });
    expect(result.accepted).toBe(true);
  });

  it("returns the workspace secret on acceptance", async () => {
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const result = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
      appVersion: "1.17.0",
    });
    expect((result as { accepted: true; secret: string }).secret).toBe("a".repeat(64));
  });

  it("inserts peer into team_peers with github_username", async () => {
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
      appVersion: "1.17.0",
    });

    const row = db
      .prepare("SELECT display_name, github_username FROM team_peers WHERE public_key = ?")
      .get("e".repeat(64)) as { display_name: string; github_username: string } | undefined;
    expect(row?.github_username).toBe("vulhdev");
    expect(row?.display_name).toBe("@vulhdev");
  });

  it("removes invite from workspace_invites after acceptance", async () => {
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
      appVersion: "1.17.0",
    });

    const remaining = db
      .prepare("SELECT * FROM workspace_invites WHERE github_username = 'vulhdev'")
      .all();
    expect(remaining).toHaveLength(0);
  });

  it("returns accepted=false when GitHub username is not in pending list", async () => {
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("stranger");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const result = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
      appVersion: "1.17.0",
    });
    expect(result.accepted).toBe(false);
    expect((result as { accepted: false; reason: string }).reason).toMatch(/@stranger/);
  });

  it("returns accepted=false when GitHub token verification fails", async () => {
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockRejectedValue(new Error("GitHub API error: 401"));
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const result = await handleJoinRequest(db, "myws", {
      githubToken: "bad_token",
      peerPublicKey: "e".repeat(64),
      appVersion: "1.17.0",
    });
    expect(result.accepted).toBe(false);
    expect((result as { accepted: false; reason: string }).reason).toMatch(/verification failed/i);
  });

  it("returns accepted=false when no pending invites exist", async () => {
    const emptyDb = createTestDb();
    const ws = createWorkspace(emptyDb, "myws");
    insertTeam(emptyDb, ws.id, {
      role: "host",
      secret: "a".repeat(64),
      noise_public_key: "b".repeat(64),
      noise_secret_key: "c".repeat(64),
      host_public_key: null,
      last_synced_at: null,
    });
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const result = await handleJoinRequest(emptyDb, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
      appVersion: "1.17.0",
    });
    expect(result.accepted).toBe(false);
    expect((result as { accepted: false; reason: string }).reason).toBe("no pending invites");
  });

  it("SUGG-2: rejects invite older than 24 hours", async () => {
    const expiredDb = createTestDb();
    seedJoinSetup(expiredDb, { invitedAt: EXPIRED_ISO });
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const result = await handleJoinRequest(expiredDb, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
      appVersion: "1.17.0",
    });
    expect(result.accepted).toBe(false);
    expect((result as { accepted: false; reason: string }).reason).toMatch(/expired/i);
  });

  it("SUGG-2: accepts invite within 24 hours", async () => {
    const recentDb = createTestDb();
    seedJoinSetup(recentDb, { invitedAt: RECENT_ISO });
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const result = await handleJoinRequest(recentDb, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
      appVersion: "1.17.0",
    });
    expect(result.accepted).toBe(true);
  });

  it("SUGG-1: rejects when claimed githubUsername does not match resolved token", async () => {
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const result = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
      githubUsername: "hacker",
      appVersion: "1.17.0",
    });
    expect(result.accepted).toBe(false);
    expect((result as { accepted: false; reason: string }).reason).toMatch(/username mismatch/i);
  });

  it("SUGG-1: accepts when claimed githubUsername matches resolved token", async () => {
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const result = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
      githubUsername: "vulhdev",
      appVersion: "1.17.0",
    });
    expect(result.accepted).toBe(true);
  });

  it("[MEDIUM-SEC] rejects peerPublicKey that is not 64 lowercase hex characters", async () => {
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    // Too short
    const r1 = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "abc123", // invalid: not 64 hex chars
      appVersion: "1.17.0",
    });
    expect(r1.accepted).toBe(false);
    expect((r1 as { reason: string }).reason).toMatch(/invalid.*public.?key/i);

    // Correct length but uppercase (not lowercase hex)
    const r2 = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "A".repeat(64),
      appVersion: "1.17.0",
    });
    expect(r2.accepted).toBe(false);
  });

  it("rejects github token longer than 255 characters", async () => {
    const { handleJoinRequest } = await import("../../src/sync/join.js");
    const result = await handleJoinRequest(db, "myws", {
      githubToken: "x".repeat(256),
      peerPublicKey: "e".repeat(64),
      appVersion: "1.17.0",
    });
    expect(result.accepted).toBe(false);
    expect((result as { accepted: false; reason: string }).reason).toMatch(/invalid github token/i);
  });

  it("SEC-10: rejects a kicked peer who re-joins under a new keypair", async () => {
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    db.prepare(
      "INSERT INTO team_peers (public_key, display_name, github_username, is_active) VALUES (?, ?, ?, 0)",
    ).run("old".repeat(21) + "x", "@vulhdev", "vulhdev");

    const result = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
      appVersion: "1.17.0",
    });
    expect(result.accepted).toBe(false);
    expect((result as { accepted: false; reason: string }).reason).toMatch(/removed/i);
  });

  it("TOCTOU: invite is removed after first join; second join for same username is rejected", async () => {
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const sharedDb = createTestDb();
    seedJoinSetup(sharedDb);

    const r1 = await handleJoinRequest(sharedDb, "myws", { githubToken: "tok1", peerPublicKey: "e".repeat(64), appVersion: "1.17.0" });
    const r2 = await handleJoinRequest(sharedDb, "myws", { githubToken: "tok2", peerPublicKey: "f".repeat(64), appVersion: "1.17.0" });

    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(false);
  });

  it("returns accepted=false when workspace not found in DB", async () => {
    const { handleJoinRequest } = await import("../../src/sync/join.js");
    const result = await handleJoinRequest(db, "nonexistent", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
      appVersion: "1.17.0",
    });
    expect(result.accepted).toBe(false);
    expect((result as { accepted: false; reason: string }).reason).toBe("workspace not found");
  });

  // Version gating tests
  it("rejects when appVersion is missing", async () => {
    const { handleJoinRequest } = await import("../../src/sync/join.js");
    const result = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
    });
    expect(result.accepted).toBe(false);
    expect((result as { accepted: false; reason: string }).reason).toMatch(/appVersion required/i);
  });

  it("rejects when peer minor version does not match host", async () => {
    const { handleJoinRequest } = await import("../../src/sync/join.js");
    const result = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
      appVersion: "1.16.0",
    });
    expect(result.accepted).toBe(false);
    const reason = (result as { accepted: false; reason: string }).reason;
    expect(reason).toMatch(/version mismatch/i);
    expect(reason).toContain("1.16.x");
    expect(reason).toContain("1.17.x");
  });

  it("passes version check when patch differs but minor matches", async () => {
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { handleJoinRequest } = await import("../../src/sync/join.js");
    const result = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
      appVersion: "1.17.99",
    });
    expect(result.accepted).toBe(true);
  });
});

describe("handleJoinRequest — inFlight composite key (same module instance)", () => {
  it("[MEDIUM-SEC] allows same username to join two different workspaces concurrently when inFlight uses composite key", async () => {
    // This test purposely does NOT call vi.resetModules() so both calls share the same
    // module-level inFlight Set, reproducing the real production behaviour.
    // If inFlight is keyed by username only, the second concurrent request returns
    // "join already in progress" instead of succeeding.
    const db1 = createTestDb();
    const db2 = createTestDb();
    seedJoinSetup(db1);
    seedJoinSetup(db2);

    const { getGitHubUsername } = await import("../../src/team/github.js");

    // Hold both GitHub calls simultaneously so both are truly in-flight together.
    let resolveGH1!: (v: string) => void;
    let resolveGH2!: (v: string) => void;
    vi.mocked(getGitHubUsername)
      .mockImplementationOnce(() => new Promise((r) => { resolveGH1 = r; }))
      .mockImplementationOnce(() => new Promise((r) => { resolveGH2 = r; }));

    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const p1 = handleJoinRequest(db1, "myws", { githubToken: "tok1", peerPublicKey: "e".repeat(64), appVersion: "1.17.0" });
    const p2 = handleJoinRequest(db2, "myws", { githubToken: "tok2", peerPublicKey: "f".repeat(64), appVersion: "1.17.0" });

    // Let both GitHub calls resolve with the same username
    resolveGH1("vulhdev");
    resolveGH2("vulhdev");

    const [r1, r2] = await Promise.all([p1, p2]);

    // Both must accept — they are in different workspaces
    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(true);
  });
});

describe("deriveJoinTopic", () => {
  const HOST_PK = "b".repeat(64);

  it("returns a 32-byte Buffer distinct from the sync topic", async () => {
    const { deriveJoinTopic } = await import("../../src/sync/join.js");
    // Inline sync topic formula (sha256 of "<secret>:<workspace>:sync") to avoid
    // importing peer.ts which pulls in hyperswarm (not installed in test env).
    const syncTopic = createHash("sha256").update(`${"a".repeat(64)}:myws:sync`).digest();
    const joinTopic = deriveJoinTopic("myws", HOST_PK);
    expect(joinTopic.length).toBe(32);
    expect(joinTopic.toString("hex")).not.toBe(syncTopic.toString("hex"));
  });

  it("is deterministic", async () => {
    const { deriveJoinTopic } = await import("../../src/sync/join.js");
    expect(deriveJoinTopic("ws", HOST_PK).toString("hex")).toBe(
      deriveJoinTopic("ws", HOST_PK).toString("hex"),
    );
  });

  it("SEC-5: topic differs when hostPublicKey differs", async () => {
    const { deriveJoinTopic } = await import("../../src/sync/join.js");
    const t1 = deriveJoinTopic("ws", "a".repeat(64));
    const t2 = deriveJoinTopic("ws", "c".repeat(64));
    expect(t1.toString("hex")).not.toBe(t2.toString("hex"));
  });

  it("SEC-5: topic differs when workspace name differs", async () => {
    const { deriveJoinTopic } = await import("../../src/sync/join.js");
    const t1 = deriveJoinTopic("ws-a", HOST_PK);
    const t2 = deriveJoinTopic("ws-b", HOST_PK);
    expect(t1.toString("hex")).not.toBe(t2.toString("hex"));
  });
});

describe("handleJoinRequest — re-invite after delete", () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = createTestDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
    vi.resetModules();
    seedJoinSetup(db);
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects kicked peer (baseline)", async () => {
    const { handleJoinRequest } = await import("../../src/sync/join.js");
    const OLD_PK = "1".repeat(64);
    const NEW_PK = "2".repeat(64);
    db.prepare("INSERT INTO team_peers (public_key, display_name, github_username, is_active) VALUES (?, ?, ?, 0)")
      .run(OLD_PK, "@vulhdev", "vulhdev");
    const result = await handleJoinRequest(db, "myws", { githubToken: "tok", peerPublicKey: NEW_PK, appVersion: "1.17.0" });
    expect(result.accepted).toBe(false);
    expect((result as { accepted: false; reason: string }).reason).toMatch(/has been removed/);
  });

  it("allows join after deletePeer clears the row", async () => {
    const { handleJoinRequest } = await import("../../src/sync/join.js");
    const { deletePeer } = await import("../../src/team/kick.js");

    const OLD_PK = "1".repeat(64);
    const NEW_PK = "2".repeat(64);
    db.prepare("INSERT INTO team_peers (public_key, display_name, github_username, is_active) VALUES (?, ?, ?, 0)")
      .run(OLD_PK, "@vulhdev", "vulhdev");
    deletePeer(db, OLD_PK);

    const result = await handleJoinRequest(db, "myws", { githubToken: "tok", peerPublicKey: NEW_PK, appVersion: "1.17.0" });
    expect(result.accepted).toBe(true);
    expect((result as { accepted: true; secret: string }).secret).toBe("a".repeat(64));

    const row = db.prepare(`SELECT is_active FROM team_peers WHERE public_key = '${NEW_PK}'`).get() as { is_active: number };
    expect(row.is_active).toBe(1);
  });
});
