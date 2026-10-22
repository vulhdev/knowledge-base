#!/usr/bin/env node
// E2E test orchestrator: builds images, runs the 3-service compose, reports pass/fail.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const composeFile = join(__dirname, "docker-compose.e2e.yml");

function compose(...args) {
  const result = spawnSync(
    "docker",
    ["compose", "-f", composeFile, ...args],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`docker compose ${args[0]} exited with code ${result.status}`);
  }
}

try {
  console.log("=== Building E2E images ===");
  compose("build");

  console.log("\n=== Running E2E suite ===");
  compose("up", "--abort-on-container-exit", "--exit-code-from", "peer");

  console.log("\n✓ E2E test PASSED");
} catch (err) {
  console.error(`\n✗ E2E test FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  try {
    compose("down", "--volumes");
  } catch {
    // cleanup failure is non-fatal
  }
}
