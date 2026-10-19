import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { homedir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { applySchema } from "./schema.js";
import { startBackfill } from "../embedding/backfill.js";
import { loadSettings } from "../config.js";

let instance: Database.Database | null = null;

export function openDb(): Database.Database {
  if (instance) return instance;

  const { db_path: dbPath } = loadSettings();

  try {
    instance = new Database(dbPath);
    loadSqliteVec(instance);
  } catch (err) {
    throw new Error(
      `Failed to load better-sqlite3. Build tools may be missing.\n\n` +
      `  macOS:   xcode-select --install\n` +
      `  Linux:   sudo apt-get install build-essential\n` +
      `  Windows: npm install -g windows-build-tools\n\n` +
      `Then run: npm rebuild better-sqlite3\n\nOriginal error: ${err}`,
    );
  }

  applySchema(instance);
  startBackfill(instance);
  return instance;
}

/** Resolve symlinks of a path that may not exist yet (resolves the nearest existing parent). */
function canonicalPath(path: string): string {
  const abs = resolve(path);
  if (existsSync(abs)) return realpathSync(abs);
  const parent = dirname(abs);
  return join(existsSync(parent) ? realpathSync(parent) : parent, basename(abs));
}

/**
 * The user's live database paths: the default location, the legacy pre-settings location, the
 * DB_PATH override and, when settings.json exists, its db_path. Reads settings.json directly —
 * never through loadSettings(), which would create it.
 */
export function realDbPaths(home: string = homedir()): string[] {
  const dir = join(home, ".claude", "knowledge-base");
  const paths = [join(dir, "knowledge-base.db"), join(home, ".claude", "knowledge-base.db")];
  if (process.env.DB_PATH) paths.push(process.env.DB_PATH);
  const settingsPath = join(dir, "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const { db_path } = JSON.parse(readFileSync(settingsPath, "utf8")) as { db_path?: string };
      if (db_path) paths.push(db_path);
    } catch {
      // unreadable settings: the default path is still guarded
    }
  }
  return paths.map(canonicalPath);
}

/** Throw when `path` is the user's real database. Only stats paths — never opens them. */
export function assertNotRealDb(path: string, home: string = homedir()): void {
  if (path === ":memory:") return;
  const target = canonicalPath(path);
  if (realDbPaths(home).includes(target)) {
    throw new Error(`Refusing to open the real knowledge-base database: ${target}. Use a test database path.`);
  }
}

/** Open (or create) a database at an explicit path. No singleton, no background backfill. */
export function openDbAt(path: string, home: string = homedir()): Database.Database {
  assertNotRealDb(path, home);
  const db = new Database(path);
  loadSqliteVec(db);
  applySchema(db);
  return db;
}
