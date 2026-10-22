import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const BLOCK_START = "<!-- knowledge-base:start -->";
const BLOCK_END = "<!-- knowledge-base:end -->";

export function buildBlock(workspace: string): string {
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
- **When referencing a document by ID** — always include the \`gui_url\` from the tool result to make it Cmd+clickable. Format: \`type#id (gui_url)\`. Example: \`idea#123 (http://localhost:57891/content/123)\`.

## Never Do

- NEVER save without user confirmation (\`search_semantic\` and \`list_contents\` are always safe to call).
- NEVER create a duplicate — if a doc on the same topic exists, use \`update_content\` instead.
- NEVER call \`create_content\` directly for user-initiated saves — always invoke \`/knowledge-base-create\` so the full save flow runs (conflict detection, link suggestion).
- NEVER include knowledge-base document IDs in git commit messages, PR descriptions, or code comments — these IDs are internal and meaningless outside the knowledge-base tool.

## Skills & MCP Tools

| Tool / Skill | Use for |
|------|---------|
| \`/knowledge-base-create\` (skill) | Save a new spec / plan / idea / doc — use for all user-initiated saves |
| \`/knowledge-base-diff\` (skill) | Compare two versions of a doc — shows unified diff in chat + GUI URL |
| \`create_content\` | Internal/programmatic saves only (e.g. derive, digest tools) |
| \`get_content\` | Fetch a specific doc by ID |
| \`list_contents\` | Browse all docs in a workspace; filter by feature and/or type |
| \`search_semantic\` | Semantic search by vector similarity (multilingual, 50+ languages) |
| \`update_content\` | Update body, type, or title of an existing doc by ID |
| \`delete_content\` | Permanently delete a doc by ID (add \`cascade=true\` to delete all versions) |
| \`create_version\` | Snapshot the current doc body as a new version |
| \`list_versions\` | List all versions in a document's chain |
| \`link_content\` | Link two docs as parent → child |
| \`derive_content\` | Create a new doc linked to a parent in one step |
| \`get_lineage\` | Get full ancestor/descendant chain for a doc |
| \`attach_code_ref\` | Link a git commit to a plan at task granularity |
| \`get_code_refs\` | List git commits linked to a doc, grouped by task |
| \`kb-conflict-resolver\` (agent) | Deep conflict analysis when \`semantic_contradiction\` is detected |

\`KNOWLEDGE_BASE_WORKSPACE=${workspace}\`
${BLOCK_END}`;
}

export function writeWorkspaceToClaude(name: string): void {
  const claudeMdPath = resolve(process.cwd(), "CLAUDE.md");
  // Guard: refuse to write outside the user's home directory to prevent
  // an attacker-influenced cwd from writing to arbitrary filesystem paths.
  if (!claudeMdPath.startsWith(homedir())) {
    throw new Error(`Refusing to write CLAUDE.md outside home directory: ${claudeMdPath}`);
  }
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

export function readWorkspaceFromClaudeMd(cwd?: string): string | null {
  const dir = cwd ?? process.cwd();
  const path = join(dir, "CLAUDE.md");
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8");
    const match = /^KNOWLEDGE_BASE_WORKSPACE=(\S+)/m.exec(text);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
