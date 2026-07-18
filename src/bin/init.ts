#!/usr/bin/env node
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, existsSync } from "node:fs";
import * as p from "@clack/prompts";
import { openDb } from "../db/client.js";
import { listWorkspaces, createWorkspace } from "../db/workspaces.js";
import { isModelReady, getEmbedding } from "../embedding/model.js";

const CREATE_NEW = "__new__";
const SKIP = "__skip__";
const BLOCK_START = "<!-- knowledge-base:start -->";
const BLOCK_END = "<!-- knowledge-base:end -->";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_SRC = join(PACKAGE_ROOT, "skills");
const AGENTS_SRC = join(PACKAGE_ROOT, "agents");
const VERSION = (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;
const VERSION_MARKER = ".knowledge-base-version";

function buildBlock(workspace: string): string {
  return `${BLOCK_START}
# Knowledge Base

This project is linked to workspace **${workspace}**. Use the \`knowledge-base\` MCP tools to persist and retrieve documents across sessions.

> Run \`npx @vulhdev/knowledge-base init\` to re-configure.

## Always Do

- **After writing a spec** — when you've just produced a structured specification document (Problem, Solution, Scope sections, or output of \`/spec\` skill), ask: *"Save this spec to knowledge-base?"* then invoke \`/knowledge-base-create\`.
- **After writing a plan** — when you've just produced a numbered implementation plan or roadmap (output of \`/plan\` skill or similar), ask: *"Save this plan to knowledge-base?"* then invoke \`/knowledge-base-create\`.
- **After writing an idea one-pager** — when you've just produced an ideation document with assumptions and MVP scope (output of \`/agent-skills:idea-refine\`), ask: *"Save this idea to knowledge-base?"* then invoke \`/knowledge-base-create\`.
- **After creating a git commit** — if the current session has an active plan doc, call \`attach_code_ref\` to link the commit to that plan. Read the session context to find the plan's \`content_id\` and the matching \`task_ref\` (e.g. the task description that was just implemented), then call \`attach_code_ref(content_id, commit_hash, file_paths, task_ref)\`. Skip silently if no plan doc is active in the session.
- **Before starting a bug fix**, ask: *"Search knowledge-base for prior context first?"* If user agrees, call \`search_semantic(query="...", workspace="${workspace}")\`.
- **Before starting a new feature**, silently call \`list_contents(workspace="${workspace}")\` and surface any relevant prior docs if found.

## Never Do

- NEVER save without user confirmation (\`search_semantic\` and \`list_contents\` are always safe to call).
- NEVER create a duplicate — if a doc on the same topic exists, use \`update_content\` instead.
- NEVER call \`create_content\` directly for user-initiated saves — always invoke \`/knowledge-base-create\` so the full save flow runs (conflict detection, link suggestion).

## Skills & MCP Tools

| Tool / Skill | Use for |
|------|---------|
| \`/knowledge-base-create\` (skill) | Save a new spec / plan / idea / doc — use for all user-initiated saves |
| \`create_content\` | Internal/programmatic saves only (e.g. derive, digest tools) |
| \`get_content\` | Fetch a specific doc by ID |
| \`list_contents\` | Browse all docs in a workspace; filter by feature and/or type |
| \`search_semantic\` | Semantic search by vector similarity (multilingual, 50+ languages) |
| \`update_content\` | Update body, type, or title of an existing doc by ID |
| \`delete_content\` | Permanently delete a doc by ID |
| \`link_content\` | Link two docs as parent → child |
| \`derive_content\` | Create a new doc linked to a parent in one step |
| \`get_lineage\` | Get full ancestor/descendant chain for a doc |
| \`attach_code_ref\` | Link a git commit to a plan at task granularity |
| \`get_code_refs\` | List git commits linked to a doc, grouped by task |
| \`kb-conflict-resolver\` (agent) | Deep conflict analysis when \`semantic_contradiction\` is detected |

\`KNOWLEDGE_BASE_WORKSPACE=${workspace}\`
${BLOCK_END}`;
}

function writeWorkspaceToClaude(name: string): void {
  const claudeMdPath = join(process.cwd(), "CLAUDE.md");
  const block = buildBlock(name);
  const blockPattern = /<!--\s*knowledge-base:start\s*-->[\s\S]*?<!--\s*knowledge-base:end\s*-->/;

  let content: string;
  try {
    content = readFileSync(claudeMdPath, "utf8");
    if (blockPattern.test(content)) {
      content = content.replace(blockPattern, block);
    } else {
      content = content.endsWith("\n")
        ? content + "\n" + block + "\n"
        : content + "\n\n" + block + "\n";
    }
  } catch {
    content = block + "\n";
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

function copyAgents(destBase: string): string[] {
  const copied: string[] = [];
  if (!existsSync(AGENTS_SRC)) return copied;

  const agents = readdirSync(AGENTS_SRC).filter((f) => f.endsWith(".md"));

  for (const agent of agents) {
    mkdirSync(destBase, { recursive: true });
    cpSync(join(AGENTS_SRC, agent), join(destBase, agent));
    copied.push(agent.replace(".md", ""));
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
  p.log.success(`Written knowledge-base block to CLAUDE.md (workspace: ${workspaceName})`);

  if (isModelReady()) {
    p.log.info("Embedding model already cached — skipping download.");
  } else {
    const modelSpinner = p.spinner();
    modelSpinner.start("Downloading embedding model (~120 MB, first time only)…");
    try {
      await getEmbedding("warm-up");
      modelSpinner.stop("Embedding model downloaded.");
    } catch (err) {
      modelSpinner.stop("Model download failed. Run `npx @vulhdev/knowledge-base init` again to retry.");
      p.log.warn(String(err));
    }
  }

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

  if (!p.isCancel(skillsDest) && (skillsDest as string) !== SKIP) {
    const copied = copySkills(skillsDest as string);
    if (copied.length > 0) {
      writeFileSync(join(skillsDest as string, VERSION_MARKER), VERSION, "utf8");
      p.log.success(`Installed ${copied.length} skills to ${skillsDest}`);
      for (const skill of copied) p.log.info(`  /${skill}`);
    } else {
      p.log.warn("No skills found to install.");
    }
  }

  const agentsDest = await p.select<string>({
    message: "Install Claude Code agents?",
    options: [
      {
        value: join(homedir(), ".claude", "agents"),
        label: "Global (~/.claude/agents/)",
        hint: "available in all projects",
      },
      {
        value: join(process.cwd(), ".claude", "agents"),
        label: "This project (./.claude/agents/)",
        hint: "current project only",
      },
      { value: SKIP, label: "Skip" },
    ],
  });

  if (!p.isCancel(agentsDest) && (agentsDest as string) !== SKIP) {
    const copied = copyAgents(agentsDest as string);
    if (copied.length > 0) {
      writeFileSync(join(agentsDest as string, VERSION_MARKER), VERSION, "utf8");
      p.log.success(`Installed ${copied.length} agents to ${agentsDest}`);
      for (const agent of copied) p.log.info(`  ${agent}`);
    } else {
      p.log.warn("No agents found to install.");
    }
  }

  p.outro("Done. Restart Claude Code to pick up the new skills and agents.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
