import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, unlinkSync } from "node:fs";

export type Settings = {
  db_path: string;
  model_cache_dir: string;
};

const SETTINGS_DIR  = join(homedir(), ".claude", "knowledge-base");
const SETTINGS_PATH = join(SETTINGS_DIR, "settings.json");
const DEFAULT_DB    = join(SETTINGS_DIR, "knowledge-base.db");
const DEFAULT_MODEL = join(homedir(), ".cache", "knowledge-base", "models");
const LEGACY_DB     = join(homedir(), ".claude", "knowledge-base.db");

let cached: Settings | null = null;

export function loadSettings(): Settings {
  if (cached) return cached;
  cached = readOrMigrate();
  return cached;
}

function readOrMigrate(): Settings {
  if (existsSync(SETTINGS_PATH)) {
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf8") as string) as Settings;
  }

  mkdirSync(SETTINGS_DIR, { recursive: true });

  let dbPath = process.env.DB_PATH ?? DEFAULT_DB;

  if (existsSync(LEGACY_DB)) {
    try {
      renameSync(LEGACY_DB, DEFAULT_DB);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EXDEV") {
        copyFileSync(LEGACY_DB, DEFAULT_DB);
        unlinkSync(LEGACY_DB);
      }
    }
    dbPath = DEFAULT_DB;
  }

  const settings: Settings = {
    db_path: dbPath,
    model_cache_dir: process.env.MODEL_CACHE_DIR ?? DEFAULT_MODEL,
  };

  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  return settings;
}
