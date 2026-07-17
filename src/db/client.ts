import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { applySchema } from "./schema.js";

let instance: Database.Database | null = null;

export function openDb(): Database.Database {
  if (instance) return instance;

  const dbPath = process.env.DB_PATH;
  if (!dbPath) {
    throw new Error("DB_PATH environment variable is not set");
  }

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
  return instance;
}
