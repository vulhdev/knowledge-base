import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkspaceFromClaudeMd } from "../../src/sync/claude-md.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kb-mcp-boot-"));
  dirs.push(d);
  return d;
}

import { afterEach } from "vitest";
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

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
