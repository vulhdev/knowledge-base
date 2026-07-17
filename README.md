<img src="assets/kb-lockup-tagline.png" alt="knowledge-base" width="380" />

An MCP server for Claude Code that provides persistent document storage using SQLite. Organize your ideas, specs, plans, and feature documentation in a structured three-level hierarchy.

```
workspace → feature → content (idea | spec | plan | digest | doc)
```

## Features

- **Persistent storage** — all content survives across Claude Code sessions
- **Five content types** — `idea`, `spec`, `plan`, `doc` (current-state feature docs), plus `digest` for summaries
- **Optional title field** — short label on any document for easy scanning in list/search results
- **Semantic search** — on-device vector similarity search powered by `sqlite-vec` and a local ONNX embedding model (multilingual, 50+ languages including Vietnamese)
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

Opens a read-only web UI at `http://localhost:3000` (override with `PORT=<n>`). Browse workspaces → features → documents, or search across all content.

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

-- Virtual table managed by sqlite-vec; kept in sync via INSERT/UPDATE/DELETE triggers
CREATE VIRTUAL TABLE vec_contents USING vec0(embedding float[384]);
```

Existing databases are automatically migrated on startup:
- `title` column added if missing
- Legacy `CHECK` constraint on `type` removed (validation enforced at the application layer via Zod)
- `embedding` column added if missing; existing rows backfilled asynchronously on the next server startup after `npx @vulhdev/knowledge-base init` (model must be downloaded first)

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
