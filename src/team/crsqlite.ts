import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { inflateRawSync } from "node:zlib";
import { loadSettings } from "../config.js";
import type Database from "better-sqlite3";

const CRSQLITE_VERSION = "0.16.3";

type PlatformEntry = {
  zipName: string;
  binName: string;
  sha256: string;
};

export const PLATFORM_ZIP_MAP: Record<string, PlatformEntry> = {
  "darwin-arm64": {
    zipName: "crsqlite-darwin-aarch64.zip",
    binName: "crsqlite-darwin-aarch64.dylib",
    sha256: "654e83fd86d975a0420174511df9f5b3d3786afb3b9fe510842ca4c34b42f746",
  },
  "darwin-x64": {
    zipName: "crsqlite-darwin-x86_64.zip",
    binName: "crsqlite-darwin-x86_64.dylib",
    sha256: "d482404950ab161f8d898b096d558017120e22684bf1678a0220ec3e77bf8624",
  },
  "linux-x64": {
    zipName: "crsqlite-linux-x86_64.zip",
    binName: "crsqlite-linux-x86_64.so",
    sha256: "8f6fd31a2be2ba8c3101aad067a504a2e63c8e9b51cc4ace786009c02e7ecbae",
  },
  "win32-x64": {
    zipName: "crsqlite-win-x86_64.zip",
    binName: "crsqlite-win-x86_64.dll",
    sha256: "401f9950dc274a52c0aaf180f175c603bebc272c561734baafff4211437ea5da",
  },
};

function getPlatformEntry(): PlatformEntry {
  const key = `${process.platform}-${process.arch}`;
  const entry = PLATFORM_ZIP_MAP[key];
  if (!entry) throw new Error(`cr-sqlite: unsupported platform ${key}`);
  return entry;
}

export function getCrsqlitePath(): string {
  const { model_cache_dir } = loadSettings();
  const entry = getPlatformEntry();
  return join(model_cache_dir, "crsqlite", entry.binName);
}

export function isCrsqliteReady(): boolean {
  try {
    return existsSync(getCrsqlitePath());
  } catch {
    return false;
  }
}

export function extractZipEntry(zipBuf: Buffer, entryName: string): Buffer {
  let offset = 0;
  while (offset + 30 <= zipBuf.length) {
    const sig = zipBuf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const compression = zipBuf.readUInt16LE(offset + 8);
    const compressedSize = zipBuf.readUInt32LE(offset + 18);
    const filenameLen = zipBuf.readUInt16LE(offset + 26);
    const extraLen = zipBuf.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + filenameLen + extraLen;
    if (dataStart + compressedSize > zipBuf.length) break;
    const filename = zipBuf.subarray(offset + 30, offset + 30 + filenameLen).toString("utf8");
    const compressedData = zipBuf.subarray(dataStart, dataStart + compressedSize);

    if (filename === entryName) {
      if (compression === 0) return Buffer.from(compressedData);
      if (compression === 8) return Buffer.from(inflateRawSync(compressedData));
      throw new Error(`cr-sqlite: unsupported compression ${compression} for ${entryName}`);
    }

    offset = dataStart + compressedSize;
  }
  throw new Error(`cr-sqlite: entry "${entryName}" not found in zip`);
}

function downloadToBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
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
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      }).on("error", reject);
    }
    follow(url);
  });
}

export async function downloadCrsqlite(): Promise<void> {
  const dest = getCrsqlitePath();
  const entry = getPlatformEntry();
  const url = `https://github.com/vlcn-io/cr-sqlite/releases/download/v${CRSQLITE_VERSION}/${entry.zipName}`;

  const zipBuf = await downloadToBuffer(url);

  const actual = createHash("sha256").update(zipBuf).digest("hex");
  if (actual !== entry.sha256) {
    throw new Error(`cr-sqlite checksum mismatch for ${entry.zipName}: expected ${entry.sha256} got ${actual}`);
  }

  const binary = extractZipEntry(zipBuf, entry.binName);

  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, binary);
}

export function loadCrsqlite(db: Database.Database): void {
  db.loadExtension(getCrsqlitePath());
}
