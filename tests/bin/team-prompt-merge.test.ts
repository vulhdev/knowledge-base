import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "../setup.js";
import { insertTeam } from "../../src/db/team.js";
import { createWorkspace } from "../../src/db/workspaces.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("hyperswarm", () => ({ default: vi.fn() }));
vi.mock("node:os", () => ({ homedir: vi.fn().mockReturnValue("/test/home") }));
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn(),
  chmodSync: vi.fn(), renameSync: vi.fn(), copyFileSync: vi.fn(), unlinkSync: vi.fn(),
}));

const mockSelect = vi.fn();
const mockConfirm = vi.fn();
const mockIsCancel = vi.fn().mockReturnValue(false);
const mockLogSuccess = vi.fn();
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(), outro: vi.fn(),
  log: { success: mockLogSuccess, info: vi.fn(), error: vi.fn() },
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  select: (...args: unknown[]) => mockSelect(...args),
  confirm: (...args: unknown[]) => mockConfirm(...args),
  isCancel: (v: unknown) => mockIsCancel(v),
}));

const mockMergeWorkspace = vi.fn().mockReturnValue({ featuresMoved: 5, featuresRenamed: [] });
vi.mock("../../src/sync/merge.js", () => ({ mergeWorkspace: (...a: unknown[]) => mockMergeWorkspace(...a) }));

vi.stubGlobal("process", { ...process, argv: ["node", "knowledge-base", "team"], exit: vi.fn() });

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDb() { return createTestDb(); }

function addTeamWorkspace(db: ReturnType<typeof makeDb>, name: string): void {
  const ws = createWorkspace(db, name);
  insertTeam(db, ws.id, {
    role: "peer", secret: "a".repeat(64),
    noise_public_key: "b".repeat(64), noise_secret_key: "c".repeat(64),
    host_public_key: "d".repeat(64), last_synced_at: null,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("promptMerge", () => {
  let promptMerge: (db: import("better-sqlite3").Database, ws: string) => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockIsCancel.mockReturnValue(false);
    // Re-import to pick up mocks (no resetModules — mocks are file-level)
    ({ promptMerge } = await import("../../src/bin/team.js"));
  });

  it("returns without prompting when no non-team workspaces exist", async () => {
    const db = makeDb();
    addTeamWorkspace(db, "team-ws");

    await promptMerge(db, "team-ws");

    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("calls mergeWorkspace when user picks a workspace and confirms", async () => {
    const db = makeDb();
    addTeamWorkspace(db, "team-ws");
    createWorkspace(db, "local-ws");

    mockSelect.mockResolvedValue("local-ws");
    mockConfirm.mockResolvedValue(true);

    await promptMerge(db, "team-ws");

    expect(mockMergeWorkspace).toHaveBeenCalledWith(db, "local-ws", "team-ws");
    expect(mockLogSuccess).toHaveBeenCalled();
  });

  it("skips merge when user selects null (Skip option)", async () => {
    const db = makeDb();
    addTeamWorkspace(db, "team-ws");
    createWorkspace(db, "local-ws");

    mockSelect.mockResolvedValue(null);

    await promptMerge(db, "team-ws");

    expect(mockMergeWorkspace).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("skips merge when user cancels the select prompt", async () => {
    const db = makeDb();
    addTeamWorkspace(db, "team-ws");
    createWorkspace(db, "local-ws");

    const cancelSym = Symbol("cancel");
    mockSelect.mockResolvedValue(cancelSym);
    mockIsCancel.mockImplementation((v) => v === cancelSym);

    await promptMerge(db, "team-ws");

    expect(mockMergeWorkspace).not.toHaveBeenCalled();
  });

  it("skips merge when user declines confirmation", async () => {
    const db = makeDb();
    addTeamWorkspace(db, "team-ws");
    createWorkspace(db, "local-ws");

    mockSelect.mockResolvedValue("local-ws");
    mockConfirm.mockResolvedValue(false);

    await promptMerge(db, "team-ws");

    expect(mockMergeWorkspace).not.toHaveBeenCalled();
    expect(mockLogSuccess).not.toHaveBeenCalled();
  });
});
