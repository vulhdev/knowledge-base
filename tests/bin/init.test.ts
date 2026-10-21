import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted before any import) ────────────────────────────────────────

vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue('{"version":"1.0.0"}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
  cpSync: vi.fn(),
}));

const mockLog = { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() };
const mockSelect = vi.fn();
const mockConfirm = vi.fn();
const mockText = vi.fn();
const mockIsCancel = vi.fn();
const mockSpinner = vi.fn(() => ({ start: vi.fn(), stop: vi.fn() }));

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  log: mockLog,
  spinner: mockSpinner,
  select: (...args: unknown[]) => mockSelect(...args),
  confirm: (...args: unknown[]) => mockConfirm(...args),
  text: (...args: unknown[]) => mockText(...args),
  isCancel: (v: unknown) => mockIsCancel(v),
}));

vi.mock("../../src/db/client.js", () => ({ openDb: vi.fn().mockReturnValue({}) }));
vi.mock("../../src/db/workspaces.js", () => ({
  listWorkspaces: vi.fn().mockReturnValue([{ name: "test-ws" }]),
  createWorkspace: vi.fn(),
}));
vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(true),
  getEmbedding: vi.fn(),
}));
vi.mock("../../src/team/crsqlite.js", () => ({
  isCrsqliteReady: vi.fn().mockReturnValue(true),
  downloadCrsqlite: vi.fn(),
}));
vi.mock("../../src/team/github.js", () => ({
  startDeviceFlow: vi.fn().mockResolvedValue({
    deviceCode: "dev-code",
    userCode: "USER-CODE",
    verificationUri: "https://github.com/login/device",
    interval: 5,
    expiresIn: 900,
  }),
  pollForToken: vi.fn().mockResolvedValue("gho_token"),
  getGitHubUsername: vi.fn().mockResolvedValue("alice"),
}));

const mockLoadSettings = vi.fn();
const mockWriteSettings = vi.fn();

vi.mock("../../src/config.js", () => ({
  loadSettings: () => mockLoadSettings(),
  writeSettings: (s: unknown) => mockWriteSettings(s),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SKIP = "__skip__";

const STALE_TEAM = {
  role: "host" as const,
  secret: "s".repeat(64),
  noise_keypair: { publicKey: "p".repeat(64), secretKey: "k".repeat(64) },
};
const VALID_TEAM = {
  role: "host" as const,
  secret: "s".repeat(64),
  noise_keypair: { publicKey: "p".repeat(64), secretKey: "k".repeat(128) },
};

function makeSettings(team: typeof STALE_TEAM | typeof VALID_TEAM) {
  return {
    identity: { name: "Alice", email: "alice@example.com", github_username: "alice" },
    workspaces: { "test-ws": { team } },
  };
}

function setupSelects(...teamAndBeyond: string[]) {
  mockSelect.mockReset();
  mockSelect.mockResolvedValueOnce("test-ws"); // workspace
  for (const v of teamAndBeyond) mockSelect.mockResolvedValueOnce(v);
  mockSelect.mockResolvedValueOnce(SKIP); // skills (if not already provided)
  mockSelect.mockResolvedValueOnce(SKIP); // agents (if not already provided)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("init team mode re-configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockIsCancel.mockReturnValue(false);
    vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);
  });

  it("stale keypair: auto-migrates to Ed25519 without showing Keep/Reconfigure prompt", async () => {
    mockLoadSettings.mockReturnValue(makeSettings(STALE_TEAM));
    setupSelects(); // no team select — stale path skips the prompt
    const { main } = await import("../../src/bin/init.js");
    await main();

    expect(mockWriteSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaces: expect.objectContaining({
          "test-ws": expect.objectContaining({
            team: expect.objectContaining({
              noise_keypair: expect.objectContaining({
                secretKey: expect.stringMatching(/^[0-9a-f]{128}$/),
              }),
            }),
          }),
        }),
      }),
    );

    for (const [opts] of mockSelect.mock.calls) {
      const labels: string[] = ((opts as { options: { label: string }[] }).options ?? []).map(
        (o: { label: string }) => o.label,
      );
      expect(labels.some((l) => l.toLowerCase().includes("reconfigure"))).toBe(false);
    }
  });

  it("stale keypair: logs restart reminder after migration", async () => {
    mockLoadSettings.mockReturnValue(makeSettings(STALE_TEAM));
    setupSelects();
    const { main } = await import("../../src/bin/init.js");
    await main();

    const warnCalls = mockLog.warn.mock.calls.flat().join(" ");
    expect(warnCalls).toContain("Restart team server");
  });

  it("valid keypair: shows Keep/Reconfigure select prompt", async () => {
    mockLoadSettings.mockReturnValue(makeSettings(VALID_TEAM));
    setupSelects("keep");
    const { main } = await import("../../src/bin/init.js");
    await main();

    const teamSelectCall = mockSelect.mock.calls.find(([opts]) => {
      const labels: string[] = ((opts as { options: { label: string }[] }).options ?? []).map(
        (o: { label: string }) => o.label,
      );
      return labels.some((l) => l.toLowerCase().includes("reconfigure"));
    });
    expect(teamSelectCall).toBeDefined();
  });

  it("valid keypair + Keep: writeSettings is not called", async () => {
    mockLoadSettings.mockReturnValue(makeSettings(VALID_TEAM));
    setupSelects("keep");
    const { main } = await import("../../src/bin/init.js");
    await main();

    expect(mockWriteSettings).not.toHaveBeenCalled();
  });

  it("valid keypair + Reconfigure + cancel confirm: writeSettings is not called", async () => {
    mockLoadSettings.mockReturnValue(makeSettings(VALID_TEAM));
    setupSelects("reconfigure");
    mockConfirm.mockResolvedValueOnce(false);
    const { main } = await import("../../src/bin/init.js");
    await main();

    expect(mockWriteSettings).not.toHaveBeenCalled();
  });

  it("valid keypair + Reconfigure + confirm: writeSettings called with new Ed25519 keypair", async () => {
    mockLoadSettings.mockReturnValue(makeSettings(VALID_TEAM));
    setupSelects("reconfigure");
    mockConfirm.mockResolvedValueOnce(true);
    const { main } = await import("../../src/bin/init.js");
    await main();

    expect(mockWriteSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaces: expect.objectContaining({
          "test-ws": expect.objectContaining({
            team: expect.objectContaining({
              noise_keypair: expect.objectContaining({
                secretKey: expect.stringMatching(/^[0-9a-f]{128}$/),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("reconfigure path: logs restart reminder after writeSettings", async () => {
    mockLoadSettings.mockReturnValue(makeSettings(VALID_TEAM));
    setupSelects("reconfigure");
    mockConfirm.mockResolvedValueOnce(true);
    const { main } = await import("../../src/bin/init.js");
    await main();

    const warnCalls = mockLog.warn.mock.calls.flat().join(" ");
    expect(warnCalls).toContain("Restart team server");
  });
});
