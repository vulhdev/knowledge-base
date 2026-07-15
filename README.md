<img src="assets/kb-lockup-tagline.png" alt="knowledge-base" width="380" />

An MCP server for Claude Code that provides persistent document storage using SQLite. Organize your ideas, specs, plans, and feature documentation in a structured three-level hierarchy.

```
workspace → feature → content (idea | spec | plan | digest | doc)
```

## Features

- **Persistent storage** — all content survives across Claude Code sessions
- **Five content types** — `idea`, `spec`, `plan`, `doc` (current-state feature docs), plus `digest` for summaries
- **Optional title field** — short label on any document for easy scanning in list/search results
- **Full-text search** — powered by SQLite FTS5 with BM25 relevance ranking
- **Zero external dependencies** — uses Node.js built-in `node:sqlite` (no native compilation)
- **Claude Code skills** — 11 slash commands for create, list, search, get, update, delete, import, export, explore, digest, and doc analysis

## Requirements

- Node.js 22.5 or later

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
2. Ask where to install **Claude Code skills**:
   - **Global** (`~/.claude/skills/`) — available in all projects
   - **This project** (`./.claude/skills/`) — current project only
   - **Skip**

After installing, restart Claude Code to pick up the new skills.

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
| `/search` → `knowledge-base:search` | Full-text search when you know what to look for |
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

### `search_content`

Full-text search across document bodies. Supports SQLite FTS5 MATCH syntax. Returns results ordered by BM25 relevance, including `title` on every result.

```
query      — search terms (FTS5 MATCH syntax supported)
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Existing databases are automatically migrated on startup: the `title` column is added if missing, and the legacy `CHECK` constraint on `type` is removed (validation is enforced at the application layer via Zod).

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
