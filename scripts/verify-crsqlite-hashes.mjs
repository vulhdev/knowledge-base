#!/usr/bin/env node
/**
 * Verifies that the SHA-256 hashes hardcoded in src/team/crsqlite.ts still
 * match the files currently served at the GitHub release URL, and that the
 * expected binName entry exists inside each zip.
 *
 * Run manually:  node scripts/verify-crsqlite-hashes.mjs
 * Run in CI:     same command (scheduled weekly via verify-crsqlite-hashes.yml)
 *
 * Exits 0 if all checks pass, 1 on any failure.
 */

import { createHash } from "node:crypto";
import { get as httpsGet } from "node:https";
import { readFileSync } from "node:fs";

// ---- Parse version + entries from source (avoids TS compilation) -----------

const src = readFileSync(new URL("../src/team/crsqlite.ts", import.meta.url), "utf8");

const versionMatch = src.match(/const CRSQLITE_VERSION\s*=\s*"([^"]+)"/);
if (!versionMatch) { console.error("Could not parse CRSQLITE_VERSION"); process.exit(1); }
const VERSION = versionMatch[1];

// Extract zipName / binName / sha256 triples from PLATFORM_ZIP_MAP
const entryRegex = /zipName:\s*"([^"]+)"[^}]*?binName:\s*"([^"]+)"[^}]*?sha256:\s*"([0-9a-f]{64})"/gs;
const entries = [];
for (const m of src.matchAll(entryRegex)) {
  entries.push({ zipName: m[1], binName: m[2], sha256: m[3] });
}
if (entries.length === 0) { console.error("Could not parse PLATFORM_ZIP_MAP entries"); process.exit(1); }

// ---- Download helper --------------------------------------------------------

function download(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error(`Too many redirects: ${url}`));
  return new Promise((resolve, reject) => {
    httpsGet(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        resolve(download(res.headers.location, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ---- Minimal ZIP local-file-header parser to list entry names ---------------

function listZipEntries(buf) {
  const names = [];
  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const filenameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const name = buf.subarray(offset + 30, offset + 30 + filenameLen).toString("utf8");
    names.push(name);
    offset = offset + 30 + filenameLen + extraLen + compressedSize;
  }
  return names;
}

// ---- Verify -----------------------------------------------------------------

console.log(`Verifying cr-sqlite v${VERSION} (${entries.length} platforms)…\n`);

let failed = false;

for (const { zipName, binName, sha256: expected } of entries) {
  const url = `https://github.com/vlcn-io/cr-sqlite/releases/download/v${VERSION}/${zipName}`;
  process.stdout.write(`  ${zipName}\n`);

  let buf;
  try {
    buf = await download(url);
  } catch (err) {
    console.log(`    ✖ download failed: ${err.message}`);
    failed = true;
    continue;
  }

  // Hash check
  const actual = createHash("sha256").update(buf).digest("hex");
  if (actual !== expected) {
    console.log(`    ✖ SHA-256 mismatch`);
    console.log(`      expected: ${expected}`);
    console.log(`      actual:   ${actual}`);
    failed = true;
  } else {
    console.log(`    ✓ SHA-256 OK`);
  }

  // Entry-name check
  const names = listZipEntries(buf);
  if (names.includes(binName)) {
    console.log(`    ✓ entry "${binName}" found`);
  } else {
    console.log(`    ✖ entry "${binName}" NOT found in zip (found: ${names.join(", ")})`);
    console.log(`      → update binName in PLATFORM_ZIP_MAP`);
    failed = true;
  }
}

if (failed) {
  console.error("\n✖ Verification failed. Update PLATFORM_ZIP_MAP in src/team/crsqlite.ts.");
  process.exit(1);
} else {
  console.log("\n✓ All checks passed.");
}
