import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:os", () => ({ homedir: vi.fn().mockReturnValue("/test/home") }));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  chmodSync: vi.fn(),
  renameSync: vi.fn(),
  copyFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

const MOCK_HOST_CONFIG = {
  role: "host" as const,
  secret: "a".repeat(64),
  noise_keypair: { publicKey: "a".repeat(64), secretKey: "b".repeat(64) },
};

describe("generateInvite", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns invite code in <hostPublicKey>:<workspaceName> format", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        db_path: "/db",
        model_cache_dir: "/m",
        workspaces: { myws: { team: MOCK_HOST_CONFIG } },
      }),
    );
    const { generateInvite } = await import("../../src/team/invite.js");
    const code = generateInvite("myws", "vulhdev");
    expect(code).toBe("a".repeat(64) + ":myws");
  });

  it("SUGG-2: saves pending_invites entry with invited_at ISO timestamp", async () => {
    const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        db_path: "/db",
        model_cache_dir: "/m",
        workspaces: { myws: { team: MOCK_HOST_CONFIG } },
      }),
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T10:00:00.000Z"));
    const { generateInvite } = await import("../../src/team/invite.js");
    generateInvite("myws", "vulhdev");

    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    const invites = written.workspaces.myws.team.pending_invites as Array<{ username: string; invited_at: string }>;
    expect(invites).toHaveLength(1);
    expect(invites[0].username).toBe("vulhdev");
    expect(invites[0].invited_at).toBe("2026-10-20T10:00:00.000Z");
    vi.useRealTimers();
  });

  it("saves github username to pending_github_usernames in settings.json", async () => {
    const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        db_path: "/db",
        model_cache_dir: "/m",
        workspaces: { myws: { team: MOCK_HOST_CONFIG } },
      }),
    );
    const { generateInvite } = await import("../../src/team/invite.js");
    generateInvite("myws", "vulhdev");

    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written.workspaces.myws.team.pending_github_usernames).toContain("vulhdev");
  });

  it("throws when workspace has no team config", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ db_path: "/db", model_cache_dir: "/m" }),
    );
    const { generateInvite } = await import("../../src/team/invite.js");
    expect(() => generateInvite("myws", "vulhdev")).toThrow(/no team config/i);
  });

  it("re-inviting same user replaces the existing entry (no duplicate)", async () => {
    const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    const FIRST_INVITE_ISO = "2026-10-18T00:00:00.000Z";
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        db_path: "/db",
        model_cache_dir: "/m",
        workspaces: {
          myws: {
            team: {
              ...MOCK_HOST_CONFIG,
              pending_github_usernames: ["vulhdev"],
              pending_invites: [{ username: "vulhdev", invited_at: FIRST_INVITE_ISO }],
            },
          },
        },
      }),
    );
    const { generateInvite } = await import("../../src/team/invite.js");
    generateInvite("myws", "vulhdev");

    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    const invites = written.workspaces.myws.team.pending_invites as Array<{ username: string; invited_at: string }>;
    const usernames = written.workspaces.myws.team.pending_github_usernames as string[];

    // Exactly one entry for vulhdev (no duplicate)
    expect(invites.filter((i) => i.username === "vulhdev")).toHaveLength(1);
    expect(usernames.filter((u) => u === "vulhdev")).toHaveLength(1);

    // The surviving entry should be the NEW one (not the old FIRST_INVITE_ISO)
    const entry = invites.find((i) => i.username === "vulhdev")!;
    expect(entry.invited_at).not.toBe(FIRST_INVITE_ISO);
  });

  it("throws when caller is not the host", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        db_path: "/db",
        model_cache_dir: "/m",
        workspaces: {
          myws: { team: { ...MOCK_HOST_CONFIG, role: "peer" } },
        },
      }),
    );
    const { generateInvite } = await import("../../src/team/invite.js");
    expect(() => generateInvite("myws", "vulhdev")).toThrow(/only the host/i);
  });
});
