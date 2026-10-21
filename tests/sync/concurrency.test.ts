import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema } from "../../src/db/schema.js";
import { writeSettingsTo } from "../../src/config.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kb-concurrency-"));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("WAL mode — applySchema on file DB", () => {
  it("enables WAL journal mode", () => {
    const dir = tmp();
    const db = new Database(join(dir, "t.db"));
    loadSqliteVec(db);
    applySchema(db);
    const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(row.journal_mode).toBe("wal");
    db.close();
  });

  it("sets busy_timeout to 5000ms", () => {
    const dir = tmp();
    const db = new Database(join(dir, "t.db"));
    loadSqliteVec(db);
    applySchema(db);
    const row = db.prepare("PRAGMA busy_timeout").get() as { timeout: number };
    expect(row.timeout).toBe(5000);
    db.close();
  });

  it("does not throw on in-memory DB (WAL silently ignored)", () => {
    const db = new Database(":memory:");
    loadSqliteVec(db);
    expect(() => applySchema(db)).not.toThrow();
    db.close();
  });
});

describe("writeSettingsTo — atomic write", () => {
  it("produces valid JSON after two sequential writes to the same path", () => {
    const dir = tmp();
    const path = join(dir, "settings.json");
    const s1 = { db_path: "/a.db", model_cache_dir: "/m" };
    const s2 = { db_path: "/b.db", model_cache_dir: "/m" };

    writeSettingsTo(s1, dir, path);
    writeSettingsTo(s2, dir, path);

    const content = readFileSync(path, "utf8");
    const parsed = JSON.parse(content) as { db_path: string };
    expect(parsed.db_path).toBe("/b.db");
  });

  it("leaves no .tmp file on success", () => {
    const dir = tmp();
    const path = join(dir, "settings.json");
    writeSettingsTo({ db_path: "/x.db", model_cache_dir: "/m" }, dir, path);

    expect(existsSync(path + ".tmp")).toBe(false);
    expect(existsSync(path)).toBe(true);
  });
});
