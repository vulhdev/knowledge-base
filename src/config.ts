import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync, copyFileSync, unlinkSync } from "node:fs";

export type Identity = { name: string; email: string; github_username?: string };

// Legacy workspace team config — read-only, used only for one-time migration in openDb().
type LegacyTeamConfig = {
  role: "host" | "peer";
  secret: string;
  noise_keypair: { publicKey: string; secretKey: string };
  pending_github_usernames?: string[];
  pending_invites?: { username: string; invited_at: string }[];
  host_public_key?: string;
  last_synced_at?: string;
};

export type Settings = {
  db_path: string;
  model_cache_dir: string;
  identity?: Identity;
  /** @deprecated Migrated to workspace_team + workspace_invites tables on first openDb() call. */
  workspaces?: Record<string, { team?: LegacyTeamConfig }>;
};

const SETTINGS_DIR  = join(homedir(), ".claude", "knowledge-base");
const SETTINGS_PATH = join(SETTINGS_DIR, "settings.json");
const DEFAULT_DB    = join(SETTINGS_DIR, "knowledge-base.db");
const DEFAULT_MODEL = join(homedir(), ".cache", "knowledge-base", "models");
const LEGACY_DB     = join(homedir(), ".claude", "knowledge-base.db");

export const LOG_DIR = join(SETTINGS_DIR, "logs");

let cached: Settings | null = null;

export function loadSettings(): Settings {
  if (cached) return cached;
  cached = readOrMigrate();
  return cached;
}

export function writeSettingsTo(settings: Settings, dir: string, path: string): void {
  mkdirSync(dir, { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(settings, null, 2));
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function writeSettings(settings: Settings): void {
  writeSettingsTo(settings, SETTINGS_DIR, SETTINGS_PATH);
  cached = null;
}

function readOrMigrate(): Settings {
  if (existsSync(SETTINGS_PATH)) {
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Settings;
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
  chmodSync(SETTINGS_PATH, 0o600);
  return settings;
}
