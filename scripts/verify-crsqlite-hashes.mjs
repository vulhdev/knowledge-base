#!/usr/bin/env node
/**
 * Verifies that the SHA-256 hashes hardcoded in src/team/crsqlite.ts still
 * match the files currently served at the GitHub release URL.
 *
 * Run manually:  node scripts/verify-crsqlite-hashes.mjs
 * Run in CI:     same command (scheduled weekly via verify-crsqlite-hashes.yml)
 *
 * Exits 0 if all hashes match, 1 if any mismatch or download fails.
 */

import { createHash } from "node:crypto";
import { get as httpsGet } from "node:https";
import { readFileSync } from "node:fs";

// ---- Parse version and hashes from source (avoids TS compilation) ----------

const src = readFileSync(new URL("../src/team/crsqlite.ts", import.meta.url), "utf8");

const versionMatch = src.match(/const CRSQLITE_VERSION\s*=\s*"([^"]+)"/);
if (!versionMatch) { console.error("Could not parse CRSQLITE_VERSION"); process.exit(1); }
const VERSION = versionMatch[1];

// Extract all  zipName / sha256 pairs from PLATFORM_ZIP_MAP
const entryRegex = /zipName:\s*"([^"]+)"[^}]*?sha256:\s*"([0-9a-f]{64})"/gs;
const entries = [];
for (const m of src.matchAll(entryRegex)) {
  entries.push({ zipName: m[1], sha256: m[2] });
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

// ---- Verify -----------------------------------------------------------------

console.log(`Verifying cr-sqlite v${VERSION} hashes (${entries.length} platforms)…\n`);

let failed = false;

for (const { zipName, sha256: expected } of entries) {
  const url = `https://github.com/vlcn-io/cr-sqlite/releases/download/v${VERSION}/${zipName}`;
  process.stdout.write(`  ${zipName} … `);
  try {
    const buf = await download(url);
    const actual = createHash("sha256").update(buf).digest("hex");
    if (actual === expected) {
      console.log(`OK`);
    } else {
      console.log(`MISMATCH`);
      console.log(`    expected: ${expected}`);
      console.log(`    actual:   ${actual}`);
      failed = true;
    }
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    failed = true;
  }
}

if (failed) {
  console.error("\n✖ Hash verification failed. Update PLATFORM_ZIP_MAP in src/team/crsqlite.ts.");
  process.exit(1);
} else {
  console.log("\n✓ All hashes match.");
}
