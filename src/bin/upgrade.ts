#!/usr/bin/env node
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import * as p from "@clack/prompts";

const PACKAGE_NAME = "@vulhdev/knowledge-base";
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_SRC = join(PACKAGE_ROOT, "skills");
const AGENTS_SRC = join(PACKAGE_ROOT, "agents");
const VERSION = (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;
const VERSION_MARKER = ".knowledge-base-version";

async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`);
  if (!res.ok) throw new Error(`Registry responded with ${res.status}`);
  const data = await res.json() as { version: string };
  return data.version;
}

function findInstalledSkillRoots(): string[] {
  return [
    join(homedir(), ".claude", "skills"),
    join(process.cwd(), ".claude", "skills"),
  ].filter((dir) => {
    if (!existsSync(dir)) return false;
    return readdirSync(dir, { withFileTypes: true }).some(
      (e) => e.isDirectory() && e.name.startsWith("knowledge-base-")
    );
  });
}

function findInstalledAgentRoots(): string[] {
  if (!existsSync(AGENTS_SRC)) return [];
  const packagedAgents = new Set(readdirSync(AGENTS_SRC).filter((f) => f.endsWith(".md")));
  return [
    join(homedir(), ".claude", "agents"),
    join(process.cwd(), ".claude", "agents"),
  ].filter((dir) => {
    if (!existsSync(dir)) return false;
    return readdirSync(dir).some((f) => packagedAgents.has(f));
  });
}

function copySkills(destBase: string): void {
  if (!existsSync(SKILLS_SRC)) return;
  for (const entry of readdirSync(SKILLS_SRC, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dest = join(destBase, entry.name);
    mkdirSync(dest, { recursive: true });
    cpSync(join(SKILLS_SRC, entry.name), dest, { recursive: true });
  }
}

function copyAgents(destBase: string): void {
  if (!existsSync(AGENTS_SRC)) return;
  for (const agent of readdirSync(AGENTS_SRC).filter((f) => f.endsWith(".md"))) {
    mkdirSync(destBase, { recursive: true });
    cpSync(join(AGENTS_SRC, agent), join(destBase, agent));
  }
}

function syncLocalAssets(): boolean {
  const skillRoots = findInstalledSkillRoots();
  const agentRoots = findInstalledAgentRoots();

  if (skillRoots.length === 0 && agentRoots.length === 0) {
    p.log.warn("No installed skills or agents found. Run `npx @vulhdev/knowledge-base init` first.");
    return false;
  }

  for (const root of skillRoots) {
    const prev = (() => { try { return readFileSync(join(root, VERSION_MARKER), "utf8").trim(); } catch { return null; } })();
    copySkills(root);
    writeFileSync(join(root, VERSION_MARKER), VERSION, "utf8");
    p.log.success(`Skills synced ${prev ? `${prev} → ` : ""}${VERSION}  (${root})`);
  }

  for (const root of agentRoots) {
    copyAgents(root);
    p.log.success(`Agents synced → ${root}`);
  }

  return true;
}

async function main(): Promise<void> {
  // Internal flag: re-invoked after npm install to sync with new binary's files
  const syncOnly = process.env.KB_UPGRADE_SYNC === "1";

  p.intro("knowledge-base upgrade");

  if (syncOnly) {
    syncLocalAssets();
    p.outro("Done.");
    return;
  }

  const spinner = p.spinner();
  spinner.start("Checking npm registry…");

  let latestVersion: string;
  try {
    latestVersion = await fetchLatestVersion();
    spinner.stop(`Current: ${VERSION}  •  Latest: ${latestVersion}`);
  } catch {
    spinner.stop("Could not reach npm registry — syncing local files.");
    syncLocalAssets();
    p.outro("Done.");
    return;
  }

  if (latestVersion === VERSION) {
    p.log.info(`Already on latest (${VERSION})`);
    syncLocalAssets();
    p.outro("Done.");
    return;
  }

  p.log.info(`Upgrading ${VERSION} → ${latestVersion}`);

  const installSpinner = p.spinner();
  installSpinner.start(`npm install -g ${PACKAGE_NAME}@latest`);
  try {
    execSync(`npm install -g ${PACKAGE_NAME}@latest`, { stdio: "pipe" });
    installSpinner.stop(`Installed ${latestVersion}`);
  } catch (err) {
    installSpinner.stop("npm install failed");
    p.log.error(String(err));
    process.exit(1);
  }

  // Re-exec the newly installed binary to sync skills/agents from the new version's files
  const result = spawnSync("knowledge-base", ["upgrade"], {
    stdio: "inherit",
    env: { ...process.env, KB_UPGRADE_SYNC: "1" },
  });

  if (result.error) {
    p.log.warn("Could not sync automatically. Run `knowledge-base update` to finish.");
  }

  p.outro("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
