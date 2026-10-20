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
vi.mock("../../src/team/github.js", () => ({
  getGitHubUsername: vi.fn(),
}));

const HOST_CONFIG = {
  role: "host" as const,
  secret: "a".repeat(64),
  noise_keypair: { publicKey: "b".repeat(64), secretKey: "c".repeat(64) },
  pending_github_usernames: ["vulhdev"],
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
    vi.resetModules();
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(makeSettingsJson());
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

  it("removes username from pending_github_usernames after acceptance", async () => {
    const { getGitHubUsername } = await import("../../src/team/github.js");
    vi.mocked(getGitHubUsername).mockResolvedValue("vulhdev");
    const { writeFileSync } = await import("node:fs");
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
    });

    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written.workspaces.myws.team.pending_github_usernames).not.toContain("vulhdev");
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
    vi.mocked(readFileSync).mockReturnValue(makeSettingsJson({ pending_github_usernames: [] }));
    const { handleJoinRequest } = await import("../../src/sync/join.js");

    const result = await handleJoinRequest(db, "myws", {
      githubToken: "gho_abc",
      peerPublicKey: "e".repeat(64),
    });
    expect(result.accepted).toBe(false);
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
