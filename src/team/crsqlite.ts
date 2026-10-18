import { join, dirname } from "node:path";
import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import { get as httpsGet } from "node:https";
import { loadSettings } from "../config.js";
import type Database from "better-sqlite3";

const CRSQLITE_VERSION = "0.16.1";

const PLATFORM_MAP: Record<string, string> = {
  "darwin-arm64": "crsqlite-darwin-aarch64.dylib",
  "darwin-x64":   "crsqlite-darwin-x86_64.dylib",
  "linux-x64":    "crsqlite-linux-x86_64.so",
  "win32-x64":    "crsqlite-windows-x86_64.dll",
};

function getExtensionFilename(): string {
  const key = `${process.platform}-${process.arch}`;
  const name = PLATFORM_MAP[key];
  if (!name) throw new Error(`cr-sqlite: unsupported platform ${key}`);
  return name;
}

export function getCrsqlitePath(): string {
  const { model_cache_dir } = loadSettings();
  return join(model_cache_dir, "crsqlite", getExtensionFilename());
}

export function isCrsqliteReady(): boolean {
  try {
    return existsSync(getCrsqlitePath());
  } catch {
    return false;
  }
}

export function downloadCrsqlite(): Promise<void> {
  const dest = getCrsqlitePath();
  mkdirSync(dirname(dest), { recursive: true });
  const filename = getExtensionFilename();
  const url = `https://github.com/vlcn-io/cr-sqlite/releases/download/v${CRSQLITE_VERSION}/${filename}`;

  return new Promise<void>((resolve, reject) => {
    function follow(location: string): void {
      httpsGet(location, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          follow(res.headers.location!);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`cr-sqlite download failed: HTTP ${res.statusCode}`));
          return;
        }
        const ws = createWriteStream(dest);
        res.pipe(ws);
        ws.on("finish", resolve);
        ws.on("error", reject);
      }).on("error", reject);
    }
    follow(url);
  });
}

export function loadCrsqlite(db: Database.Database): void {
  db.loadExtension(getCrsqlitePath());
}
