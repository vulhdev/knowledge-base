import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
vi.mock("../../src/team/github.js", () => ({
  getGitHubUsername: vi.fn(),
}));

const NOW_ISO = "2026-10-20T12:00:00.000Z";
const RECENT_ISO = "2026-10-20T11:00:00.000Z"; // 1h ago — within TTL
const EXPIRED_ISO = "2026-10-18T12:00:00.000Z"; // 48h ago — expired

const HOST_CONFIG = {
  role: "host" as const,
  secret: "a".repeat(64),
  noise_keypair: { publicKey: "b".repeat(64), secretKey: "c".repeat(64) },
  pending_github_usernames: ["vulhdev"],
  pending_invites: [{ username: "vulhdev", invited_at: RECENT_ISO }],
};

function makeSettingsJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    db_path: "/db",
    model_cache_dir: "/m",
    workspaces: { myws: { team: { ...HOST_CONFIG, ...overrides } } },
  });
}

describe("handleJoinRequest (host side)", () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = createTestDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
    vi.resetModules();
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(makeSettingsJson());
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
    });

    const row = db
      .prepare("SELECT display_name, github_username FROM team_peers WHERE public_key = ?")
      .get("e".repeat(64)) as { display_name: string; github_username: string } | undefined;
    expect(row?.github_username).toBe("vulhdev");
    expect(row?.display_name).toBe("@vulhdev");
  });

  it("removes username from pending_invites after acceptance", async () => {
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { writeFileSync } = await import("node:fs");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
    });

    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    const remaining = (written.workspaces.myws.team.pending_invites ?? []) as Array<{ username: string }>;
    expect(remaining.some((i) => i.username === "vulhdev")).toBe(false);
  });

  it("returns accepted=false when GitHub username is not in pending list", async () => {
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("stranger");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const result = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
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
    });
    expect(result.accepted).toBe(false);
    expect((result as { accepted: false; reason: string }).reason).toMatch(/verification failed/i);
  });

  it("returns accepted=false when no pending invites exist", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      makeSettingsJson({ pending_github_usernames: [], pending_invites: [] }),
    );
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const result = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
    });
    expect(result.accepted).toBe(false);
  });

  it("SUGG-2: rejects invite older than 24 hours", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      makeSettingsJson({
        pending_invites: [{ username: "vulhdev", invited_at: EXPIRED_ISO }],
      }),
    );
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const result = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
    });
    expect(result.accepted).toBe(false);
    expect((result as { accepted: false; reason: string }).reason).toMatch(/expired/i);
  });

  it("SUGG-2: accepts invite within 24 hours", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      makeSettingsJson({
        pending_invites: [{ username: "vulhdev", invited_at: RECENT_ISO }],
      }),
    );
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const result = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
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
    });
    expect(result.accepted).toBe(false);
    expect((result as { accepted: false; reason: string }).reason).toMatch(/username mismatch/i);
  });

  it("accepts user in pending_github_usernames when pending_invites is empty array", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      makeSettingsJson({
        pending_github_usernames: ["vulhdev"],
        pending_invites: [], // empty array — not undefined
      }),
    );
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const result = await handleJoinRequest(createTestDb(), "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
    });
    expect(result.accepted).toBe(true);
  });

  it("SUGG-1: accepts when claimed githubUsername matches resolved token", async () => {
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const result = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
      githubUsername: "vulhdev",
    });
    expect(result.accepted).toBe(true);
  });

  it("TOCTOU: second concurrent join for same username is rejected", async () => {
    // Use a stateful settings store so writeSettings propagates to subsequent loadSettings calls
    const { readFileSync, writeFileSync } = await import("node:fs");
    let settingsStore = makeSettingsJson();
    vi.mocked(readFileSync).mockImplementation(() => settingsStore);
    vi.mocked(writeFileSync).mockImplementation((_p, data) => {
      if (typeof data === "string" && data.includes('"workspaces"')) settingsStore = data;
    });

    const { getGitHubUsername } = await import("../../src/team/github.js");
    const resolvers: Array<(v: string) => void> = [];
    vi.mocked(getGitHubUsername).mockImplementation(() =>
      new Promise<string>((res) => { resolvers.push(res); }),
    );
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const db1 = createTestDb();
    const db2 = createTestDb();
    const p1 = handleJoinRequest(db1, "myws", { githubToken: "tok1", peerPublicKey: "e".repeat(64) });
    const p2 = handleJoinRequest(db2, "myws", { githubToken: "tok2", peerPublicKey: "f".repeat(64) });

    // Both are now awaiting their GitHub calls
    await Promise.resolve();
    expect(resolvers).toHaveLength(2);

    // Resolve C1 first — it consumes the invite and writes updated settings
    resolvers[0]("vulhdev");
    await Promise.resolve(); // drain C1's microtask chain

    // Resolve C2 — it should now read the updated settings (no invite) and be rejected
    resolvers[1]("vulhdev");

    const [r1, r2] = await Promise.all([p1, p2]);
    const results = [r1, r2];
    expect(results.filter((r) => r.accepted).length).toBe(1);
    expect(results.filter((r) => !r.accepted).length).toBe(1);
  });
});

describe("deriveJoinTopic", () => {
  const HOST_PK = "b".repeat(64);

  it("returns a 32-byte Buffer distinct from the sync topic", async () => {
    const { deriveJoinTopic } = await import("../../src/sync/join.js");
    const { deriveTopicBuffer } = await import("../../src/sync/peer.js");
    const joinTopic = deriveJoinTopic("myws", HOST_PK);
    const syncTopic = deriveTopicBuffer("myws", "a".repeat(64));
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
