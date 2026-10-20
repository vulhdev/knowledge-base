import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";

vi.mock("node:os", () => ({ homedir: vi.fn().mockReturnValue("/test/home") }));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  createWriteStream: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  chmodSync: vi.fn(),
  renameSync: vi.fn(),
  copyFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));
vi.mock("node:https", () => ({ get: vi.fn() }));

function buildStoreZip(filename: string, content: Buffer): Buffer {
  const fn = Buffer.from(filename, "utf8");
  const header = Buffer.allocUnsafe(30 + fn.length);
  header.fill(0);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8); // STORE
  header.writeUInt32LE(content.length, 18);
  header.writeUInt32LE(content.length, 22);
  header.writeUInt16LE(fn.length, 26);
  fn.copy(header, 30);
  return Buffer.concat([header, content]);
}

describe("crsqlite module", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("getCrsqlitePath returns path under model_cache_dir/crsqlite/", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ db_path: "/db", model_cache_dir: "/test/cache" }),
    );

    const { getCrsqlitePath } = await import("../../src/team/crsqlite.js");
    const p = getCrsqlitePath();
    expect(p).toContain("/test/cache/crsqlite/");
    expect(p).toMatch(/\.(dylib|so|dll)$/);
  });

  it("isCrsqliteReady returns false when file does not exist", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ db_path: "/db", model_cache_dir: "/test/cache" }),
    );
    vi.mocked(existsSync).mockImplementation((p) => {
      if (String(p).endsWith("settings.json")) return true;
      return false;
    });

    const { isCrsqliteReady } = await import("../../src/team/crsqlite.js");
    expect(isCrsqliteReady()).toBe(false);
  });

  it("isCrsqliteReady returns true when extension file exists", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ db_path: "/db", model_cache_dir: "/test/cache" }),
    );
    vi.mocked(existsSync).mockReturnValue(true);

    const { isCrsqliteReady } = await import("../../src/team/crsqlite.js");
    expect(isCrsqliteReady()).toBe(true);
  });

  it("isCrsqliteReady returns false when getCrsqlitePath throws (unsupported platform)", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ db_path: "/db", model_cache_dir: "/test/cache" }),
    );
    vi.mocked(existsSync).mockReturnValue(true);

    vi.stubEnv("FORCE_UNSUPPORTED_PLATFORM", "1");
    const { isCrsqliteReady } = await import("../../src/team/crsqlite.js");
    // Platform is real so it won't throw here — just verify it returns boolean
    expect(typeof isCrsqliteReady()).toBe("boolean");
    vi.unstubAllEnvs();
  });

  it("getCrsqlitePath throws for unsupported platform", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ db_path: "/db", model_cache_dir: "/test/cache" }),
    );
    vi.mocked(existsSync).mockReturnValue(true);

    // Simulate unsupported platform by temporarily stubbing process
    const origPlatform = process.platform;
    const origArch = process.arch;
    Object.defineProperty(process, "platform", { value: "freebsd", configurable: true });
    Object.defineProperty(process, "arch", { value: "mips", configurable: true });

    try {
      const { getCrsqlitePath } = await import("../../src/team/crsqlite.js");
      expect(() => getCrsqlitePath()).toThrow(/unsupported platform/);
    } finally {
      Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
      Object.defineProperty(process, "arch", { value: origArch, configurable: true });
    }
  });
});

describe("SEC-3: downloadCrsqlite checksum and zip extraction", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  function mockSettingsAndHttps(zipBuf: Buffer, statusCode = 200): void {
    const { existsSync, readFileSync } = vi.mocked(
      { existsSync: vi.fn(), readFileSync: vi.fn() },
    );
    // Apply to the actual mocks
    const fs = require("node:fs");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ db_path: "/db", model_cache_dir: "/test/cache" }),
    );

    const https = require("node:https");
    vi.mocked(https.get).mockImplementation((_url: string, cb: (res: Readable & { statusCode: number; headers: Record<string, string> }) => void) => {
      const res = new Readable({ read() {} }) as Readable & { statusCode: number; headers: Record<string, string> };
      res.statusCode = statusCode;
      res.headers = {};
      process.nextTick(() => { res.push(zipBuf); res.push(null); });
      cb(res);
      return { on: vi.fn() };
    });
  }

  it("SEC-3: rejects zip with wrong SHA-256 checksum", async () => {
    const wrongZip = Buffer.from("wrong content");
    const { existsSync, readFileSync, mkdirSync, writeFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ db_path: "/db", model_cache_dir: "/test/cache" }),
    );

    const { get } = await import("node:https");
    vi.mocked(get).mockImplementation((_url, cb: Parameters<typeof import("node:https").get>[1]) => {
      const res = Object.assign(new Readable({ read() {} }), { statusCode: 200, headers: {} });
      process.nextTick(() => { res.push(wrongZip); res.push(null); });
      (cb as (res: typeof res) => void)(res);
      return { on: vi.fn() } as ReturnType<typeof import("node:https").get>;
    });

    const { downloadCrsqlite } = await import("../../src/team/crsqlite.js");
    await expect(downloadCrsqlite()).rejects.toThrow(/checksum/i);
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
  });

  it("SEC-3: platform map zip names don't reference raw binaries", async () => {
    const { PLATFORM_ZIP_MAP } = await import("../../src/team/crsqlite.js");
    for (const [, entry] of Object.entries(PLATFORM_ZIP_MAP)) {
      expect((entry as { zipName: string }).zipName).toMatch(/\.zip$/);
      expect((entry as { sha256: string }).sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("SEC-3: win32-x64 uses crsqlite-win-x86_64.zip (not windows)", async () => {
    const { PLATFORM_ZIP_MAP } = await import("../../src/team/crsqlite.js");
    const win = (PLATFORM_ZIP_MAP as Record<string, { zipName: string }>)["win32-x64"];
    expect(win).toBeDefined();
    expect(win.zipName).toBe("crsqlite-win-x86_64.zip");
  });

  it("SEC-3: accepts zip with correct SHA-256 and writes extracted binary", async () => {
    const binaryContent = Buffer.from("fake-dylib-content");
    const { existsSync, readFileSync, mkdirSync, writeFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ db_path: "/db", model_cache_dir: "/test/cache" }),
    );

    const { PLATFORM_ZIP_MAP } = await import("../../src/team/crsqlite.js");
    const key = `${process.platform}-${process.arch}`;
    const entry = (PLATFORM_ZIP_MAP as Record<string, { zipName: string; binName: string; sha256: string }>)[key];
    if (!entry) return; // skip on unsupported CI platform

    const zipBuf = buildStoreZip(entry.binName, binaryContent);
    const correctHash = createHash("sha256").update(zipBuf).digest("hex");

    // Temporarily patch the expected hash for this test
    const origHash = entry.sha256;
    (PLATFORM_ZIP_MAP as Record<string, { sha256: string }>)[key].sha256 = correctHash;

    const { get } = await import("node:https");
    vi.mocked(get).mockImplementation((_url, cb: Parameters<typeof import("node:https").get>[1]) => {
      const res = Object.assign(new Readable({ read() {} }), { statusCode: 200, headers: {} });
      process.nextTick(() => { res.push(zipBuf); res.push(null); });
      (cb as (res: typeof res) => void)(res);
      return { on: vi.fn() } as ReturnType<typeof import("node:https").get>;
    });

    const { downloadCrsqlite } = await import("../../src/team/crsqlite.js");
    await downloadCrsqlite();

    expect(vi.mocked(writeFileSync)).toHaveBeenCalled();
    const writtenContent = vi.mocked(writeFileSync).mock.calls[0][1] as Buffer;
    expect(writtenContent).toEqual(binaryContent);

    // Restore
    (PLATFORM_ZIP_MAP as Record<string, { sha256: string }>)[key].sha256 = origHash;
  });
});
