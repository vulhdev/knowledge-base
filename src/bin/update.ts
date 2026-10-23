#!/usr/bin/env node
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import * as p from "@clack/prompts";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_SRC = join(PACKAGE_ROOT, "skills");
const AGENTS_SRC = join(PACKAGE_ROOT, "agents");
const VERSION = (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;
const VERSION_MARKER = ".knowledge-base-version";

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

function getInstalledVersion(skillRoot: string): string | null {
  try {
    return readFileSync(join(skillRoot, VERSION_MARKER), "utf8").trim();
  } catch {
    return null;
  }
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

async function main(): Promise<void> {
  p.intro("knowledge-base update");

  const skillRoots = findInstalledSkillRoots();
  const agentRoots = findInstalledAgentRoots();

  if (skillRoots.length === 0 && agentRoots.length === 0) {
    p.log.warn("No installed skills or agents found. Run `npx @vulhdev/knowledge-base init` first.");
    p.outro("Nothing to update.");
    return;
  }

  let updated = 0;
  for (const root of skillRoots) {
    const installedVersion = getInstalledVersion(root);
    if (installedVersion === VERSION) {
      p.log.info(`${root} — already up to date (${VERSION})`);
      continue;
    }
    copySkills(root);
    writeFileSync(join(root, VERSION_MARKER), VERSION, "utf8");
    p.log.success(`${root} — updated ${installedVersion ?? "unknown"} → ${VERSION}`);
    updated++;
  }

  for (const root of agentRoots) {
    copyAgents(root);
    p.log.success(`Agents synced → ${root}`);
    updated++;
  }

  p.outro(updated > 0 ? "Done." : "All skills and agents already up to date.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
