#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import * as p from "@clack/prompts";
import { openDb } from "../db/client.js";
import { listWorkspaces, createWorkspace } from "../db/workspaces.js";

process.env.DB_PATH ??= join(homedir(), ".claude", "knowledge-base.db");

const CREATE_NEW = "__new__";
const WORKSPACE_KEY = "KNOWLEDGE_BASE_WORKSPACE";

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
  p.outro(`Written ${WORKSPACE_KEY}=${workspaceName} to CLAUDE.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
