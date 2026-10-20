# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

- Communicate with the user in **Vietnamese**
- Write all documents (specs, plans, ideas, comments in docs/) in **English**

## Project Overview

`knowledge-base` is a Claude Code plugin (MCP server) that provides persistent document storage using SQLite. It organizes content in a three-level hierarchy:

```
workspace → feature → content (idea | spec | plan | digest | doc)
```

- **workspace**: top-level organizational unit (e.g., a project or domain)
- **feature**: a named capability or area within a workspace
- **content**: a typed document attached to a feature

## Development Commands

```bash
npm install           # Install dependencies
npm run dev           # Run MCP server via tsx (no build step)
npm run build         # Compile TypeScript to dist/
npm test              # Run all tests
npm test -- tests/tools/search-semantic.test.ts  # Run a single test file
npm run test:coverage # Tests with coverage report (src/tools/** must be ≥80% lines)
npm run lint          # Type-check without emitting
```

## Architecture

### Two processes, one database

The package has two independent server processes that share a single SQLite file:

- **MCP server** (`src/index.ts`) — stdio transport, used by Claude Code. Registered via `claude mcp add`.
- **GUI server** (`src/bin/gui.ts` → `src/gui/server.ts`) — Express HTTP server, launched by `npx knowledge-base gui`. Reads and writes the same DB file.

No IPC between them — SQLite is the sole shared state. The review flow exploits this: `wait_for_review` long-polls SQLite every 500ms for a row committed by the GUI.

### Why `better-sqlite3` (not `node:sqlite`)

`sqlite-vec` (vector search extension) requires `db.loadExtension()`, which the built-in `node:sqlite` does not support. All DB access uses `better-sqlite3`. `src/db/client.ts` is the sole entry point — it loads the extension, runs migrations, and starts the embedding backfill.

### Tool layer pattern

Each MCP tool lives in `src/tools/*.ts` as a plain exported function with no MCP SDK imports. `src/index.ts` is the only file that knows about the MCP protocol — it imports each tool function and wraps it in `server.tool(name, description, zodSchema, handler)`. This keeps tools independently testable.

### Migrations

`src/db/schema.ts` → `applySchema(db)` runs every startup. Each migration is guarded (e.g., `pragma_table_info` check, `CREATE TABLE IF NOT EXISTS`) so it is safe to run repeatedly on existing databases. Add new migrations at the top of the function body with a comment `// Migration N: description`.

### Conflict detection

`create_content` automatically checks new documents against existing ones for conflicts. `src/tools/conflict-detection.ts` runs a semantic similarity search + FTS query and returns `ConflictResult[]` with type `semantic_contradiction` (high severity) or `risk_shadow` (low severity). Results are included in `CreateContentResult.conflicts`.

### Embedding / semantic search

`src/embedding/model.ts` — loads a local ONNX model (`paraphrase-multilingual-MiniLM-L12-v2`, 384-dim float32) via `@huggingface/transformers`. The model must be downloaded first by running `npx knowledge-base init`.

`src/embedding/backfill.ts` — called once in `openDb()`. Finds `contents` rows with `embedding IS NULL` and fills them asynchronously. Does nothing if the model is not ready.

`search_semantic` runs ANN vector search + BM25 FTS5 in parallel and fuses results with Reciprocal Rank Fusion (k=60), then applies a recency boost (max +20%, 30-day half-life).

### Inline review flow

1. `open_for_review(content_id)` — inserts a `reviews` row (`status='pending'`), returns GUI URL
2. User opens GUI, selects text, adds `review_comments`, clicks Commit → POST `/review/:id/commit` → `status='committed'`
3. `wait_for_review(content_id)` — polls SQLite every 500ms until `status='committed'`, returns comments
4. Claude processes each comment → calls `resolve_comment(comment_id)` (sets `resolved_at`) per comment, then `resolve_review(review_id)` (sets `status='resolved'`) when done
5. GUI shows resolved comments at 55% opacity with a green ✓ badge

### GUI rendering

`src/gui/render.ts` — hand-crafted HTML string templates, no template engine. Inline `<style>` and `<script>` blocks per page. Uses `marked` for Markdown → HTML. The review page includes CSS Highlight API (`::highlight(comment-pending)`) to keep selection visible while the popup is open.

## Testing

All tests use `createTestDb()` from `tests/setup.ts`, which creates an in-memory `better-sqlite3` database with `sqlite-vec` loaded and all migrations applied. Import it in every test file that needs a DB.

Tests that call `wait_for_review` use very short timeouts (e.g., `0.001s`) to avoid slow suites.

## Runtime Requirements

- **Node.js 22.5+** — `better-sqlite3` requires native compilation; prebuilt binaries are bundled for common platforms
- Embedding model (~120 MB) downloaded separately via `npx knowledge-base init`

## MCP Plugin Registration

```json
{
  "mcpServers": {
    "knowledge-base": {
      "command": "node",
      "args": ["dist/index.js"]
    }
  }
}
```

DB path is read from `~/.claude/knowledge-base/settings.json` (written by `init`). Override with `DB_PATH` env var on first startup before settings.json exists.

## Database Schema

```sql
CREATE TABLE workspaces (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);

CREATE TABLE features (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  UNIQUE(workspace_id, name)
);

CREATE TABLE contents (
  id INTEGER PRIMARY KEY,
  feature_id INTEGER NOT NULL REFERENCES features(id),
  type TEXT NOT NULL,        -- any string; "idea" | "spec" | "plan" | "digest" | "doc" suggested
  title TEXT,
  body TEXT NOT NULL,
  embedding BLOB,            -- float[384], NULL until model downloaded and backfill runs
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE content_links (
  parent_id INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  child_id  INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  PRIMARY KEY (parent_id, child_id)
);

CREATE TABLE code_refs (
  id INTEGER PRIMARY KEY,
  content_id  INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  task_ref    TEXT,
  commit_hash TEXT NOT NULL,
  file_paths  TEXT NOT NULL,   -- JSON: [{"path":"src/foo.ts","start":1,"end":20}]
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(content_id, commit_hash)
);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  content_id   INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'committed' | 'resolved'
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  committed_at TEXT
);

CREATE TABLE review_comments (
  id            INTEGER PRIMARY KEY,
  review_id     INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  selected_text TEXT,
  comment       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at   TEXT    -- set by resolve_comment after Claude processes it
);
```

Virtual tables managed automatically: `vec_contents` (sqlite-vec ANN index), `contents_fts` (FTS5, indexes `title` + `body`, title weighted 5×).

# Knowledge Base

This project is linked to workspace **knowledge-base**. Use the `knowledge-base` MCP tools to persist and retrieve documents across sessions.

> Run `npx @vulhdev/knowledge-base init` to re-configure.

## Always Do

- **After writing a spec** — when you've just produced a structured specification document (Problem, Solution, Scope sections, or output of `/spec` skill), ask: *"Save this spec to knowledge-base?"* then invoke `/knowledge-base-create`.
- **After writing a plan** — when you've just produced a numbered implementation plan or roadmap (output of `/plan` skill or similar), ask: *"Save this plan to knowledge-base?"* then invoke `/knowledge-base-create`.
- **After writing an idea one-pager** — when you've just produced an ideation document with assumptions and MVP scope (output of `/agent-skills:idea-refine`), ask: *"Save this idea to knowledge-base?"* then invoke `/knowledge-base-create`.
- **After creating a git commit** — if the current session has an active plan doc, call `attach_code_ref` to link the commit to that plan. Read the session context to find the plan's `content_id` and the matching `task_ref` (e.g. the task description that was just implemented), then call `attach_code_ref(content_id, commit_hash, file_paths, task_ref)`. Skip silently if no plan doc is active in the session.
- **Before starting a bug fix**, ask: *"Search knowledge-base for prior context first?"* If user agrees, call `search_semantic(query="...", workspace="knowledge-base")`.
- **Before starting a new feature**, silently call `list_contents(workspace="knowledge-base")` and surface any relevant prior docs if found.

## Never Do

- NEVER save without user confirmation (`search_semantic` and `list_contents` are always safe to call).
- NEVER create a duplicate — if a doc on the same topic exists, use `update_content` instead.
- NEVER call `create_content` directly for user-initiated saves — always invoke `/knowledge-base-create` so the full save flow runs (conflict detection, link suggestion).
- NEVER include knowledge-base document IDs in git commit messages, PR descriptions, or code comments — these IDs are internal and meaningless outside the knowledge-base tool.

## Skills & MCP Tools

| Tool / Skill | Use for |
|------|---------|
| `/knowledge-base-create` (skill) | Save a new spec / plan / idea / doc — use for all user-initiated saves |
| `/knowledge-base-review` (skill) | Proactively open an existing doc for inline review in the GUI |
| `/knowledge-base-resolve-feedback` (skill) | Process committed review comments — classify, edit/clarify/expand, mark resolved |
| `create_content` | Internal/programmatic saves only (e.g. derive, digest tools) |
| `get_content` | Fetch a specific doc by ID |
| `list_contents` | Browse all docs in a workspace; filter by feature and/or type |
| `search_semantic` | Semantic search by vector similarity (multilingual, 50+ languages) |
| `update_content` | Update body, type, or title of an existing doc by ID |
| `delete_content` | Permanently delete a doc by ID |
| `link_content` | Link two docs as parent → child |
| `derive_content` | Create a new doc linked to a parent in one step |
| `get_lineage` | Get full ancestor/descendant chain for a doc |
| `attach_code_ref` | Link a git commit to a plan at task granularity |
| `get_code_refs` | List git commits linked to a doc, grouped by task |
| `open_for_review` | Create a review session for a doc and return the GUI URL |
| `wait_for_review` | Long-poll SQLite until the user commits the review (default 300s) |
| `get_pending_review` | Fetch the most recently committed review with comments |
| `list_contents_with_pending_review` | List docs that have committed (unprocessed) reviews |
| `resolve_comment` | Mark a single review comment as resolved after Claude processes it |
| `resolve_review` | Mark an entire review as resolved when all comments are done |
| `kb-conflict-resolver` (agent) | Deep conflict analysis when `semantic_contradiction` is detected |

`KNOWLEDGE_BASE_WORKSPACE=knowledge-base`

<!-- knowledge-base:start -->
# Knowledge Base

This project is linked to workspace **knowledge-base**. Use the `knowledge-base` MCP tools to persist and retrieve documents across sessions.

> Run `npx @vulhdev/knowledge-base init` to re-configure.

## Always Do

- **After writing a spec** — when you've just produced a structured specification document (Problem, Solution, Scope sections, or output of `/spec` skill), ask: *"Save this spec to knowledge-base?"* then invoke `/knowledge-base-create`.
- **After writing a plan** — when you've just produced a numbered implementation plan or roadmap (output of `/plan` skill or similar), ask: *"Save this plan to knowledge-base?"* then invoke `/knowledge-base-create`.
- **After writing an idea one-pager** — when you've just produced an ideation document with assumptions and MVP scope (output of `/agent-skills:idea-refine`), ask: *"Save this idea to knowledge-base?"* then invoke `/knowledge-base-create`.
- **After creating a git commit** — if the current session has an active plan doc, call `attach_code_ref` to link the commit to that plan. Read the session context to find the plan's `content_id` and the matching `task_ref` (e.g. the task description that was just implemented), then call `attach_code_ref(content_id, commit_hash, file_paths, task_ref)`. Skip silently if no plan doc is active in the session.
- **Before starting a bug fix**, ask: *"Search knowledge-base for prior context first?"* If user agrees, call `search_semantic(query="...", workspace="knowledge-base")`.
- **Before starting a new feature**, silently call `list_contents(workspace="knowledge-base")` and surface any relevant prior docs if found.
- **When referencing a document by ID** — always include the `gui_url` from the tool result to make it Cmd+clickable. Format: `type#id (gui_url)`. Example: `idea#123 (http://localhost:57891/content/123)`.

## Never Do

- NEVER save without user confirmation (`search_semantic` and `list_contents` are always safe to call).
- NEVER create a duplicate — if a doc on the same topic exists, use `update_content` instead.
- NEVER call `create_content` directly for user-initiated saves — always invoke `/knowledge-base-create` so the full save flow runs (conflict detection, link suggestion).
- NEVER include knowledge-base document IDs in git commit messages, PR descriptions, or code comments — these IDs are internal and meaningless outside the knowledge-base tool.

## Skills & MCP Tools

| Tool / Skill | Use for |
|------|---------|
| `/knowledge-base-create` (skill) | Save a new spec / plan / idea / doc — use for all user-initiated saves |
| `/knowledge-base-diff` (skill) | Compare two versions of a doc — shows unified diff in chat + GUI URL |
| `create_content` | Internal/programmatic saves only (e.g. derive, digest tools) |
| `get_content` | Fetch a specific doc by ID |
| `list_contents` | Browse all docs in a workspace; filter by feature and/or type |
| `search_semantic` | Semantic search by vector similarity (multilingual, 50+ languages) |
| `update_content` | Update body, type, or title of an existing doc by ID |
| `delete_content` | Permanently delete a doc by ID (add `cascade=true` to delete all versions) |
| `create_version` | Snapshot the current doc body as a new version |
| `list_versions` | List all versions in a document's chain |
| `link_content` | Link two docs as parent → child |
| `derive_content` | Create a new doc linked to a parent in one step |
| `get_lineage` | Get full ancestor/descendant chain for a doc |
| `attach_code_ref` | Link a git commit to a plan at task granularity |
| `get_code_refs` | List git commits linked to a doc, grouped by task |
| `kb-conflict-resolver` (agent) | Deep conflict analysis when `semantic_contradiction` is detected |

`KNOWLEDGE_BASE_WORKSPACE=knowledge-base`
<!-- knowledge-base:end -->

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **knowledge-base** (556 symbols, 1282 relationships, 34 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/knowledge-base/context` | Codebase overview, check index freshness |
| `gitnexus://repo/knowledge-base/clusters` | All functional areas |
| `gitnexus://repo/knowledge-base/processes` | All execution flows |
| `gitnexus://repo/knowledge-base/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
