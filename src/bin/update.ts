#!/usr/bin/env node
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import * as p from "@clack/prompts";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_SRC = join(PACKAGE_ROOT, "skills");
const VERSION = (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;
const VERSION_MARKER = ".knowledge-base-version";

function findInstalledSkillRoots(): string[] {
  const candidates = [
    join(homedir(), ".claude", "skills"),
    join(process.cwd(), ".claude", "skills"),
  ];
  return candidates.filter((dir) => {
    if (!existsSync(dir)) return false;
    return readdirSync(dir, { withFileTypes: true }).some(
      (e) => e.isDirectory() && e.name.startsWith("knowledge-base-")
    );
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

async function main(): Promise<void> {
  p.intro("knowledge-base update");

  const skillRoots = findInstalledSkillRoots();

  if (skillRoots.length === 0) {
    p.log.warn("No installed skills found. Run `npx @vulhdev/knowledge-base init` first.");
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

  p.outro(updated > 0 ? "Done." : "All skills already up to date.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
