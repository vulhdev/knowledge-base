<img src="assets/kb-lockup-tagline.png" alt="knowledge-base" width="380" />

An MCP server for Claude Code that provides persistent document storage using SQLite. Organize your ideas, specs, plans, and feature documentation in a structured three-level hierarchy — and track the full lineage of how ideas evolve into specs and plans.

```
workspace → feature → content (idea | spec | plan | digest | doc)
```

## Features

- **Persistent storage** — all content survives across Claude Code sessions
- **Five content types** — `idea`, `spec`, `plan`, `doc` (current-state feature docs), plus `digest` for summaries
- **Content lineage** — track provenance chains (`idea → spec → plan`); navigate ancestors and descendants with `get_lineage`, link documents with `link_content`, or create a derived document in one step with `derive_content`
- **Auto-suggest parents** — when creating a `spec` or `plan`, Claude automatically surfaces semantically similar parent candidates from the same workspace so you can link them without manual lookup
- **Optional title field** — short label on any document for easy scanning in list/search results
- **Semantic search** — on-device vector similarity search powered by `sqlite-vec` and a local ONNX embedding model (multilingual, 50+ languages including Vietnamese)
- **Error log viewer** — every unhandled MCP tool exception is captured to SQLite and viewable in the GUI at `/errors`
- **SQLite-backed** — single file database via `better-sqlite3`, no external services
- **Claude Code skills** — 11 slash commands for create, list, search, get, update, delete, import, export, explore, digest, and doc analysis

## Requirements

- Node.js 22.5 or later
- C++ build tools (for `better-sqlite3` native addon):
  - macOS: `xcode-select --install`
  - Linux: `sudo apt-get install build-essential`
  - Windows: `npm install -g windows-build-tools`

  Most users won't need this — prebuilt binaries are bundled for common platforms. If startup fails with a native addon error, run the command above then `npm rebuild better-sqlite3`.

## Setup

### 1. Add the MCP server

Run this once in any terminal:

```bash
claude mcp add knowledge-base -- npx -y @vulhdev/knowledge-base
```

That's it. The server auto-creates a database at `~/.claude/knowledge-base.db` on first run.

> To use a custom database path, pass `DB_PATH` explicitly:
> ```bash
> claude mcp add knowledge-base -e DB_PATH=/your/path/knowledge-base.db -- npx -y @vulhdev/knowledge-base
> ```

### 2. (Optional) Initialize a workspace

To link a Claude Code project to a specific workspace and install skills, run:

```bash
npx @vulhdev/knowledge-base init
```

The wizard will:
1. Prompt you to select or create a **workspace** — writes `KNOWLEDGE_BASE_WORKSPACE=<name>` to `CLAUDE.md`
2. **Download the embedding model** (~120 MB, first time only) to `~/.cache/knowledge-base/models/` — required for semantic search. Skipped automatically if already cached.
3. Ask where to install **Claude Code skills**:
   - **Global** (`~/.claude/skills/`) — available in all projects
   - **This project** (`./.claude/skills/`) — current project only
   - **Skip**

After installing, restart Claude Code to pick up the new skills.

> **Custom model cache directory:** set `MODEL_CACHE_DIR=/your/path` to override where the model is stored.

### 3. (Optional) Update skills

When a new version is released, update your installed skills with:

```bash
npx @vulhdev/knowledge-base update
```

Auto-detects skills installed in `~/.claude/skills/` and `./.claude/skills/`, and overwrites them only if the version has changed. Warns if no installed skills are found (run `init` first).

### 4. (Optional) Browse with the GUI

To explore your knowledge base in a browser, run:

```bash
npx @vulhdev/knowledge-base gui
```

Opens a read-only web UI at `http://localhost:3000` (override with `PORT=<n>`). Browse workspaces → features → documents, search across all content, or open the **Errors** tab to inspect recent MCP tool failures.

## Claude Code Skills

Skills use colon namespace notation — type the part after the colon to get autocomplete suggestions (e.g. `/doc` → `knowledge-base:doc`).

| Skill | When to use |
|---|---|
| `/create` → `knowledge-base:create` | Save a spec, plan, idea, or doc from the current conversation |
| `/list` → `knowledge-base:list` | Browse all documents in a feature (no keyword needed) |
| `/search` → `knowledge-base:search` | Semantic search — finds relevant documents even without exact keywords |
| `/get` → `knowledge-base:get` | Read the full body of a specific document by ID or description |
| `/update` → `knowledge-base:update` | Merge new content into an existing document |
| `/delete` → `knowledge-base:delete` | Permanently remove a document (with confirmation) |
| `/import` → `knowledge-base:import` | Import markdown files into the knowledge base |
| `/export` → `knowledge-base:export` | Export documents to markdown files |
| `/explore` → `knowledge-base:explore` | Proactively load feature context before starting work |
| `/digest` → `knowledge-base:digest` | Build a TL;DR + index summary for a feature |
| `/doc` → `knowledge-base:doc` | Analyze a codebase feature and save structured docs (DB schema, backend flow, frontend) |

## MCP Tools

Once registered, these tools are available to Claude:

### `create_content`

Creates a document. Auto-creates the workspace and feature if they don't exist.

```
workspace  — top-level project or domain (e.g. "my-app")
feature    — capability or area (e.g. "auth")
type       — "idea" | "spec" | "plan" | "digest" | "doc"
title      — (optional) short label for easy identification in lists
body       — document text
```

### `get_content`

Fetches a single document by its numeric ID. Returns all fields including `title`.

### `list_contents`

Lists documents in a workspace, with optional filters for feature and/or type. Returns `title` on every row.

### `search_semantic`

Semantic (vector) search across document bodies using a local ONNX embedding model. Returns documents ordered by vector similarity — finds relevant content even when the exact words don't match. Supports any natural language including Vietnamese.

Requires the embedding model to be downloaded first (`npx @vulhdev/knowledge-base init`). Embeddings for new and updated documents are generated automatically; existing documents are backfilled in the background on the next server startup after `init`.

```
query      — natural language search query (any language)
workspace  — (optional) scope to a specific workspace
type       — (optional) filter by content type
limit      — max results, 1–50 (default 10)
```

### `update_content`

Updates the body (and optionally the type and title) of an existing document by ID. Omitting `title` preserves the existing value.

```
id     — document ID
body   — new document body (replaces existing)
type   — (optional) new type, omit to keep existing
title  — (optional) new title, omit to keep existing
```

### `delete_content`

Permanently deletes a document by its numeric ID. Returns the deleted document.

---

### `link_content`

Links two existing documents as parent → child. Use this after both documents already exist.

```
child_id   — ID of the child document
parent_id  — ID of the parent document
```

Returns a `LinkResult` with `parent_id`, `child_id`, `created_at`, and an optional `direction_warning` if the type order is reversed (e.g. linking a `plan` as the parent of an `idea`). The warning is informational — the link is always created.

### `derive_content`

Creates a new document and links it to a parent in a single atomic step. Inherits the parent's workspace and feature.

```
parent_id  — ID of the parent document to derive from
type       — type for the new document ("spec", "plan", etc.)
body       — document body text
title      — (optional) short label
```

Returns the full `CreateContentResult` plus a `parent_id` field confirming the link. The response also includes `suggested_parents` in case additional related documents exist worth linking.

### `get_lineage`

Returns the full ancestry chain for a document — all ancestors (nearest → oldest) and all descendants (BFS order, nearest first).

```
content_id  — ID of the document to inspect
```

Example response:
```json
{
  "root": { "id": 12, "type": "spec", "title": "Auth redesign spec", ... },
  "ancestors": [
    { "id": 7, "type": "idea", "title": "Auth pain points idea", ... }
  ],
  "descendants": [
    { "id": 18, "type": "plan", "title": "Auth implementation plan", ... }
  ]
}
```

Returns `LinkedContent` objects (id, workspace, feature, type, title) — document bodies are omitted for brevity. Use `get_content` to fetch the full body of any node.

## Database Schema

```sql
CREATE TABLE workspaces (
  id   INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE features (
  id           INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  name         TEXT NOT NULL,
  UNIQUE(workspace_id, name)
);

CREATE TABLE contents (
  id         INTEGER PRIMARY KEY,
  feature_id INTEGER NOT NULL REFERENCES features(id),
  type       TEXT NOT NULL,   -- "idea" | "spec" | "plan" | "digest" | "doc"
  title      TEXT,            -- optional short label
  body       TEXT NOT NULL,
  embedding  BLOB,            -- float[384] vector, NULL until model is downloaded
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Provenance graph: tracks idea→spec→plan lineage chains
CREATE TABLE content_links (
  parent_id  INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  child_id   INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (parent_id, child_id)
);

-- Virtual table managed by sqlite-vec; kept in sync via INSERT/UPDATE/DELETE triggers
CREATE VIRTUAL TABLE vec_contents USING vec0(embedding float[384]);

CREATE TABLE error_logs (
  id        INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  tool_name TEXT NOT NULL,  -- MCP tool that threw (e.g. "get_content")
  message   TEXT NOT NULL,
  severity  TEXT NOT NULL DEFAULT 'error'
);
```

Existing databases are automatically migrated on startup:
- `title` column added if missing
- Legacy `CHECK` constraint on `type` removed (validation enforced at the application layer via Zod)
- `embedding` column added if missing; existing rows backfilled asynchronously on the next server startup after `npx @vulhdev/knowledge-base init` (model must be downloaded first)
- `content_links` table added if missing (Migration 4)

## Development

```bash
# Install dependencies
npm install

# Run the MCP server (no build step needed)
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type-check
npm run lint

# Build for production
npm run build
```

## License

MIT
