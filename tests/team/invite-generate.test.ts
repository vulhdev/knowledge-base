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

  it("returns invite key in <hostPublicKey>:<pendingToken> format", async () => {
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
    const key = generateInvite("myws");
    expect(key).toMatch(/^[0-9a-f]{64}:[0-9a-f]{32}$/);
    expect(key.startsWith("a".repeat(64))).toBe(true);
  });

  it("saves pending_token to settings.json", async () => {
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
    const key = generateInvite("myws");
    const token = key.split(":")[1];

    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written.workspaces.myws.team.pending_token).toBe(token);
  });

  it("throws when workspace has no team config", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ db_path: "/db", model_cache_dir: "/m" }),
    );
    const { generateInvite } = await import("../../src/team/invite.js");
    expect(() => generateInvite("myws")).toThrow(/no team config/i);
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
    expect(() => generateInvite("myws")).toThrow(/only the host/i);
  });
});
