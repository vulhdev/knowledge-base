import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { readWorkspaceFromClaudeMd } from "../../src/sync/claude-md.js";
import { startSyncFromClaudeMd } from "../../src/sync/boot.js";
import { loadSettings } from "../../src/config.js";
import { startSync } from "../../src/sync/index.js";

vi.mock("../../src/config.js", () => ({ loadSettings: vi.fn() }));
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

describe("startSyncFromClaudeMd", () => {
  const fakeDb = null as unknown as Database.Database;
  const fakeTeamConfig = {
    role: "host" as const,
    secret: "s",
    noise_keypair: { publicKey: "aa", secretKey: "bb" },
  };

  it("calls startSync and logs to stderr when workspace has team config", () => {
    const dir = tmp();
    writeFileSync(join(dir, "CLAUDE.md"), "KNOWLEDGE_BASE_WORKSPACE=test-ws\n");
    vi.mocked(loadSettings).mockReturnValue({
      db_path: "/x.db",
      model_cache_dir: "/m",
      workspaces: { "test-ws": { team: fakeTeamConfig } },
    });
    vi.mocked(startSync).mockReturnValue({ destroy: async () => {} });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    startSyncFromClaudeMd(fakeDb, dir);
    expect(startSync).toHaveBeenCalledWith(fakeDb, "test-ws");
    expect(stderrSpy).toHaveBeenCalledWith('[knowledge-base] sync started for workspace "test-ws"\n');
    stderrSpy.mockRestore();
  });

  it("does not call startSync when CLAUDE.md is missing", () => {
    const dir = tmp(); // no CLAUDE.md
    startSyncFromClaudeMd(fakeDb, dir);
    expect(startSync).not.toHaveBeenCalled();
  });

  it("does not call startSync when workspace has no team config", () => {
    const dir = tmp();
    writeFileSync(join(dir, "CLAUDE.md"), "KNOWLEDGE_BASE_WORKSPACE=test-ws\n");
    vi.mocked(loadSettings).mockReturnValue({
      db_path: "/x.db",
      model_cache_dir: "/m",
      workspaces: { "test-ws": {} },
    });
    startSyncFromClaudeMd(fakeDb, dir);
    expect(startSync).not.toHaveBeenCalled();
  });

  it("does not log when startSync returns null (lock held)", () => {
    const dir = tmp();
    writeFileSync(join(dir, "CLAUDE.md"), "KNOWLEDGE_BASE_WORKSPACE=test-ws\n");
    vi.mocked(loadSettings).mockReturnValue({
      db_path: "/x.db",
      model_cache_dir: "/m",
      workspaces: { "test-ws": { team: fakeTeamConfig } },
    });
    vi.mocked(startSync).mockReturnValue(null);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    startSyncFromClaudeMd(fakeDb, dir);
    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});
