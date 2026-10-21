import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "../setup.js";
import { insertTeam } from "../../src/db/team.js";
import { createWorkspace } from "../../src/db/workspaces.js";
import { readWorkspaceFromClaudeMd } from "../../src/sync/claude-md.js";
import { startSyncFromClaudeMd } from "../../src/sync/boot.js";
import { startSync } from "../../src/sync/index.js";

vi.mock("../../src/sync/index.js", () => ({ startSync: vi.fn() }));

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kb-mcp-boot-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  vi.clearAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("writeWorkspaceToClaude", () => {
  it("[MEDIUM-SEC] throws when process.cwd() is outside home directory", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/tmp/attacker");
    try {
      const { writeWorkspaceToClaude } = await import("../../src/sync/claude-md.js");
      expect(() => writeWorkspaceToClaude("my-ws")).toThrow(/refusing.*outside home/i);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("[MEDIUM-SEC] succeeds when process.cwd() is inside home directory", async () => {
    const dir = mkdtempSync(join(homedir(), "kb-test-"));
    dirs.push(dir);
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
    try {
      const { writeWorkspaceToClaude } = await import("../../src/sync/claude-md.js");
      expect(() => writeWorkspaceToClaude("my-ws")).not.toThrow();
    } finally {
      cwdSpy.mockRestore();
    }
  });
});

describe("readWorkspaceFromClaudeMd", () => {
  it("returns null when CLAUDE.md does not exist", () => {
    const dir = tmp();
    expect(readWorkspaceFromClaudeMd(dir)).toBeNull();
  });

  it("returns workspace name when KNOWLEDGE_BASE_WORKSPACE is set", () => {
    const dir = tmp();
    writeFileSync(join(dir, "CLAUDE.md"), "# My Project\n\nKNOWLEDGE_BASE_WORKSPACE=my-workspace\n");
    expect(readWorkspaceFromClaudeMd(dir)).toBe("my-workspace");
  });

  it("returns null when CLAUDE.md exists but has no KNOWLEDGE_BASE_WORKSPACE line", () => {
    const dir = tmp();
    writeFileSync(join(dir, "CLAUDE.md"), "# My Project\n\nSome content here.\n");
    expect(readWorkspaceFromClaudeMd(dir)).toBeNull();
  });

  it("matches KNOWLEDGE_BASE_WORKSPACE inside a code block", () => {
    const dir = tmp();
    writeFileSync(
      join(dir, "CLAUDE.md"),
      "# Project\n\n```\nKNOWLEDGE_BASE_WORKSPACE=kb-project\n```\n",
    );
    expect(readWorkspaceFromClaudeMd(dir)).toBe("kb-project");
  });
});

function seedTeamWorkspace(name: string) {
  const db = createTestDb();
  const ws = createWorkspace(db, name);
  insertTeam(db, ws.id, {
    role: "host",
    secret: "a".repeat(64),
    noise_public_key: "b".repeat(64),
    noise_secret_key: "c".repeat(64),
    host_public_key: null,
    last_synced_at: null,
  });
  return db;
}

describe("startSyncFromClaudeMd", () => {
  it("calls startSync and logs to stderr when workspace has team config", () => {
    const dir = tmp();
    writeFileSync(join(dir, "CLAUDE.md"), "KNOWLEDGE_BASE_WORKSPACE=test-ws\n");
    const db = seedTeamWorkspace("test-ws");
    vi.mocked(startSync).mockReturnValue({ destroy: async () => {} });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    startSyncFromClaudeMd(db, dir);
    expect(startSync).toHaveBeenCalledWith(db, "test-ws");
    expect(stderrSpy).toHaveBeenCalledWith('[knowledge-base] sync started for workspace "test-ws"\n');
    stderrSpy.mockRestore();
  });

  it("does not call startSync when CLAUDE.md is missing", () => {
    const dir = tmp(); // no CLAUDE.md
    const db = createTestDb();
    startSyncFromClaudeMd(db, dir);
    expect(startSync).not.toHaveBeenCalled();
  });

  it("does not call startSync when workspace has no team config", () => {
    const dir = tmp();
    writeFileSync(join(dir, "CLAUDE.md"), "KNOWLEDGE_BASE_WORKSPACE=test-ws\n");
    const db = createTestDb();
    createWorkspace(db, "test-ws");
    startSyncFromClaudeMd(db, dir);
    expect(startSync).not.toHaveBeenCalled();
  });

  it("does not log when startSync returns null (lock held)", () => {
    const dir = tmp();
    writeFileSync(join(dir, "CLAUDE.md"), "KNOWLEDGE_BASE_WORKSPACE=test-ws2\n");
    const db = seedTeamWorkspace("test-ws2");
    vi.mocked(startSync).mockReturnValue(null);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    startSyncFromClaudeMd(db, dir);
    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});
