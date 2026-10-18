import { describe, it, expect, vi, beforeEach } from "vitest";

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

const HOST_PK = "a".repeat(64);

function makeSettings(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    db_path: "/db",
    model_cache_dir: "/m",
    workspaces: {
      "my-ws": {
        team: {
          role: "host",
          secret: "s".repeat(64),
          noise_keypair: { publicKey: HOST_PK, secretKey: "k".repeat(64) },
          ...overrides,
        },
      },
    },
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("buildInviteCode", () => {
  it("returns hostPublicKey:workspaceName", async () => {
    const { buildInviteCode } = await import("../../src/team/invite.js");
    expect(buildInviteCode(HOST_PK, "my-ws")).toBe(`${HOST_PK}:my-ws`);
  });
});

describe("parseInviteCode", () => {
  it("parses valid invite code", async () => {
    const { parseInviteCode } = await import("../../src/team/invite.js");
    const result = parseInviteCode(`${HOST_PK}:my-workspace`);
    expect(result.hostPublicKey).toBe(HOST_PK);
    expect(result.workspaceName).toBe("my-workspace");
  });

  it("throws on missing colon", async () => {
    const { parseInviteCode } = await import("../../src/team/invite.js");
    expect(() => parseInviteCode("a".repeat(64))).toThrow(/invalid invite code/i);
  });

  it("throws when hostPublicKey is not 64 hex chars", async () => {
    const { parseInviteCode } = await import("../../src/team/invite.js");
    expect(() => parseInviteCode("tooshort:my-ws")).toThrow(/invalid invite code/i);
  });

  it("throws when workspaceName is empty", async () => {
    const { parseInviteCode } = await import("../../src/team/invite.js");
    expect(() => parseInviteCode(`${HOST_PK}:`)).toThrow(/workspaceName is empty/i);
  });
});

describe("normalizeGithubUsername", () => {
  it("strips @ prefix", async () => {
    const { normalizeGithubUsername } = await import("../../src/team/invite.js");
    expect(normalizeGithubUsername("@vulhdev")).toBe("vulhdev");
  });

  it("accepts username without @", async () => {
    const { normalizeGithubUsername } = await import("../../src/team/invite.js");
    expect(normalizeGithubUsername("vulhdev")).toBe("vulhdev");
  });

  it("throws on invalid username", async () => {
    const { normalizeGithubUsername } = await import("../../src/team/invite.js");
    expect(() => normalizeGithubUsername("@")).toThrow(/invalid github username/i);
    expect(() => normalizeGithubUsername("has space")).toThrow(/invalid github username/i);
  });
});

describe("generateInvite", () => {
  it("appends username to pending_github_usernames and returns invite code", async () => {
    const { readFileSync, writeFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(makeSettings());
    const { generateInvite } = await import("../../src/team/invite.js");

    const code = generateInvite("my-ws", "vulhdev");

    expect(code).toBe(`${HOST_PK}:my-ws`);
    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written.workspaces["my-ws"].team.pending_github_usernames).toContain("vulhdev");
  });

  it("appends without overwriting existing pending usernames", async () => {
    const { readFileSync, writeFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      makeSettings({ pending_github_usernames: ["alice"] }),
    );
    const { generateInvite } = await import("../../src/team/invite.js");

    generateInvite("my-ws", "bob");

    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written.workspaces["my-ws"].team.pending_github_usernames).toEqual(["alice", "bob"]);
  });

  it("throws when no team config exists", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ db_path: "/db", model_cache_dir: "/m" }));
    const { generateInvite } = await import("../../src/team/invite.js");

    expect(() => generateInvite("missing-ws", "vulhdev")).toThrow(/no team config/i);
  });

  it("throws when role is peer", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(makeSettings({ role: "peer" }));
    const { generateInvite } = await import("../../src/team/invite.js");

    expect(() => generateInvite("my-ws", "vulhdev")).toThrow(/only the host/i);
  });
});
