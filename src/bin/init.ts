#!/usr/bin/env node
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, existsSync } from "node:fs";
import * as p from "@clack/prompts";
import { openDb } from "../db/client.js";
import { listWorkspaces, createWorkspace } from "../db/workspaces.js";

process.env.DB_PATH ??= join(homedir(), ".claude", "knowledge-base.db");

const CREATE_NEW = "__new__";
const SKIP = "__skip__";
const WORKSPACE_KEY = "KNOWLEDGE_BASE_WORKSPACE";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_SRC = join(PACKAGE_ROOT, "skills");

function writeWorkspaceToClaude(name: string): void {
  const claudeMdPath = join(process.cwd(), "CLAUDE.md");
  const line = `${WORKSPACE_KEY}=${name}`;
  const pattern = /^KNOWLEDGE_BASE_WORKSPACE=.*/m;

  let content: string;
  try {
    content = readFileSync(claudeMdPath, "utf8");
    if (pattern.test(content)) {
      content = content.replace(pattern, line);
    } else {
      content = content.endsWith("\n")
        ? content + line + "\n"
        : content + "\n" + line + "\n";
    }
  } catch {
    content = line + "\n";
  }

  writeFileSync(claudeMdPath, content, "utf8");
}

function copySkills(destBase: string): string[] {
  const copied: string[] = [];
  if (!existsSync(SKILLS_SRC)) return copied;

  const skills = readdirSync(SKILLS_SRC, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  for (const skill of skills) {
    const dest = join(destBase, skill);
    mkdirSync(dest, { recursive: true });
    cpSync(join(SKILLS_SRC, skill), dest, { recursive: true });
    copied.push(skill);
  }

  return copied;
}

async function main(): Promise<void> {
  p.intro("knowledge-base init");

  const db = openDb();
  const workspaces = listWorkspaces(db);

  const selected = await p.select<string>({
    message: "Select a workspace:",
    options: [
      ...workspaces.map((w) => ({ value: w.name, label: w.name })),
      { value: CREATE_NEW, label: "+ Create new workspace" },
    ],
  });

  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  let workspaceName: string;

  if ((selected as string) === CREATE_NEW) {
    const name = await p.text({
      message: "Workspace name:",
      placeholder: "my-project",
      validate: (v: string | undefined) => (!v?.trim() ? "Name cannot be empty" : undefined),
    });

    if (p.isCancel(name)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    createWorkspace(db, name as string);
    workspaceName = name as string;
  } else {
    workspaceName = selected as string;
  }

  writeWorkspaceToClaude(workspaceName);
  p.log.success(`Written ${WORKSPACE_KEY}=${workspaceName} to CLAUDE.md`);

  const skillsDest = await p.select<string>({
    message: "Install Claude Code skills?",
    options: [
      {
        value: join(homedir(), ".claude", "skills"),
        label: "Global (~/.claude/skills/)",
        hint: "available in all projects",
      },
      {
        value: join(process.cwd(), ".claude", "skills"),
        label: "This project (./.claude/skills/)",
        hint: "current project only",
      },
      { value: SKIP, label: "Skip" },
    ],
  });

  if (p.isCancel(skillsDest) || (skillsDest as string) === SKIP) {
    p.outro("Done.");
    process.exit(0);
  }

  const copied = copySkills(skillsDest as string);
  if (copied.length > 0) {
    p.log.success(`Installed ${copied.length} skills to ${skillsDest}`);
    for (const skill of copied) p.log.info(`  /${skill}`);
  } else {
    p.log.warn("No skills found to install.");
  }

  p.outro("Done. Restart Claude Code to pick up the new skills.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
