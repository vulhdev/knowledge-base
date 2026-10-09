import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/embedding/backfill.js", () => ({ startBackfill: vi.fn() }));

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kb-open-at-"));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("openDbAt / assertNotRealDb", () => {
  it("creates a database with the schema at an explicit path and does not start backfill", async () => {
    const { openDbAt } = await import("../../src/db/client.js");
    const { startBackfill } = await import("../../src/embedding/backfill.js");
    const home = tmp();
    const db = openDbAt(join(tmp(), "t.db"), home);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toContain("contents");
    expect(tables).toContain("contents_fts");
    expect(startBackfill).not.toHaveBeenCalled();
    db.close();
  });

  it("refuses the default real DB path under the given home", async () => {
    const { assertNotRealDb } = await import("../../src/db/client.js");
    const home = tmp();
    expect(() => assertNotRealDb(join(home, ".claude", "knowledge-base", "knowledge-base.db"), home)).toThrow(/Refusing/);
  });

  it("refuses db_path from settings.json, including through a symlink", async () => {
    const { assertNotRealDb } = await import("../../src/db/client.js");
    const home = tmp();
    const kbDir = join(home, ".claude", "knowledge-base");
    mkdirSync(kbDir, { recursive: true });
    const other = tmp();
    const custom = join(other, "custom.db");
    writeFileSync(custom, "");
    writeFileSync(join(kbDir, "settings.json"), JSON.stringify({ db_path: custom, model_cache_dir: other }));
    const link = join(tmp(), "link.db");
    symlinkSync(custom, link);
    expect(() => assertNotRealDb(custom, home)).toThrow(/Refusing/);
    expect(() => assertNotRealDb(link, home)).toThrow(/Refusing/);
  });

  it("accepts any other path and :memory:", async () => {
    const { assertNotRealDb } = await import("../../src/db/client.js");
    const home = tmp();
    expect(() => assertNotRealDb(join(tmp(), "eval.db"), home)).not.toThrow();
    expect(() => assertNotRealDb(":memory:", home)).not.toThrow();
  });

  it("openDbAt refuses the real DB before creating anything", async () => {
    const { openDbAt } = await import("../../src/db/client.js");
    const home = tmp();
    expect(() => openDbAt(join(home, ".claude", "knowledge-base", "knowledge-base.db"), home)).toThrow(/Refusing/);
  });

  it("also refuses the DB_PATH override and the legacy ~/.claude/knowledge-base.db", async () => {
    const { assertNotRealDb } = await import("../../src/db/client.js");
    const home = tmp();
    expect(() => assertNotRealDb(join(home, ".claude", "knowledge-base.db"), home)).toThrow(/Refusing/);
    const custom = join(tmp(), "env.db");
    const prev = process.env.DB_PATH;
    process.env.DB_PATH = custom;
    try {
      expect(() => assertNotRealDb(custom, home)).toThrow(/Refusing/);
    } finally {
      if (prev === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = prev;
    }
    expect(() => assertNotRealDb(custom, home)).not.toThrow();
  });
});
