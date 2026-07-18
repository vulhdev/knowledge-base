import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
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
