#!/usr/bin/env node
// E2E test orchestrator: builds images, runs scenarios, reports pass/fail.
// Usage:
//   node e2e/run.mjs                        # run all scenarios sequentially
//   node e2e/run.mjs --scenario=happy-path  # run one scenario
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// exitCodeFrom: which service's exit code determines pass/fail.
// happy-path + continuous: peer verifies and exits → use peer's exit code.
// bidirectional: host verifies and exits → use host's exit code.
const SCENARIOS = {
  "happy-path": {
    composeFiles: ["docker-compose.e2e.yml"],
    exitCodeFrom: "peer",
  },
  "bidirectional": {
    composeFiles: ["docker-compose.e2e.yml", "docker-compose.bidirectional.yml"],
    exitCodeFrom: "host",
  },
  "continuous": {
    composeFiles: ["docker-compose.e2e.yml", "docker-compose.continuous.yml"],
    exitCodeFrom: "peer",
  },
};

function compose(composeFiles, ...args) {
  const fileArgs = composeFiles.flatMap(f => ["-f", join(__dirname, f)]);
  const result = spawnSync("docker", ["compose", ...fileArgs, ...args], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`docker compose ${args[0]} exited with code ${result.status}`);
  }
}

function runScenario(name, { composeFiles, exitCodeFrom }) {
  console.log(`\n=== [${name}] Building images ===`);
  compose(composeFiles, "build");
  console.log(`\n=== [${name}] Running ===`);
  // --exit-code-from implies --abort-on-container-exit.
  compose(composeFiles, "up", `--exit-code-from=${exitCodeFrom}`);
  console.log(`\n✓ [${name}] PASSED`);
}

function cleanupScenario(composeFiles) {
  try {
    compose(composeFiles, "down", "--volumes");
  } catch {
    // cleanup failure is non-fatal
  }
}

// ── Argument parsing ──────────────────────────────────────────────────────────
const scenarioArg = process.argv.find(a => a.startsWith("--scenario="));
const selectedScenario = scenarioArg ? scenarioArg.split("=")[1] : null;

if (selectedScenario !== null && !(selectedScenario in SCENARIOS)) {
  console.error(
    `Unknown scenario: "${selectedScenario}". Available: ${Object.keys(SCENARIOS).join(", ")}`,
  );
  process.exit(1);
}

const scenariosToRun = selectedScenario
  ? [[selectedScenario, SCENARIOS[selectedScenario]]]
  : Object.entries(SCENARIOS);

// ── Run ───────────────────────────────────────────────────────────────────────
let failed = false;

for (const [name, scenario] of scenariosToRun) {
  try {
    runScenario(name, scenario);
  } catch (err) {
    console.error(`\n✗ [${name}] FAILED: ${err.message}`);
    failed = true;
    cleanupScenario(scenario.composeFiles);
    break;
  }
  cleanupScenario(scenario.composeFiles);
}

if (failed) process.exitCode = 1;
