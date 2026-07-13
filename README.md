# knowledge-base

An MCP server for Claude Code that provides persistent document storage using SQLite. Organize your ideas, specs, and plans in a structured three-level hierarchy.

```
workspace → feature → content (idea | spec | plan | digest)
```

## Features

- **Persistent storage** — all content survives across Claude Code sessions
- **Three content types** — `idea`, `spec`, `plan`, plus `digest` for summaries
- **Full-text search** — powered by SQLite FTS5 with BM25 relevance ranking
- **Zero external dependencies** — uses Node.js built-in `node:sqlite` (no native compilation)
- **Claude Code skills** — import, export, search, and digest via slash commands

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
npx @vulhdev/knowledge-base-init
```

The wizard will:
1. Prompt you to select or create a **workspace** — writes `KNOWLEDGE_BASE_WORKSPACE=<name>` to `CLAUDE.md`
2. Ask where to install **Claude Code skills**:
   - **Global** (`~/.claude/skills/`) — available in all projects
   - **This project** (`./.claude/skills/`) — current project only
   - **Skip**

After installing, restart Claude Code to pick up the new skills:

| Skill | Command | Description |
|---|---|---|
| `/knowledge-base-search` | Full-text search across all content |
| `/knowledge-base-import` | Import content from files |
| `/knowledge-base-export` | Export content to files |
| `/knowledge-base-digest` | Summarize content into a digest |

## MCP Tools

Once registered, these tools are available to Claude:

### `create_content`

Creates a document. Auto-creates the workspace and feature if they don't exist.

```
workspace  — top-level project or domain (e.g. "my-app")
feature    — capability or area (e.g. "auth")
type       — "idea" | "spec" | "plan" | "digest"
body       — document text
```

### `get_content`

Fetches a single document by its numeric ID.

### `list_contents`

Lists documents in a workspace, with optional filters for feature and/or type.

### `search_content`

Full-text search across document bodies. Supports SQLite FTS5 MATCH syntax. Returns results ordered by BM25 relevance.

```
query      — search terms (FTS5 MATCH syntax supported)
workspace  — (optional) scope to a specific workspace
type       — (optional) filter by content type
limit      — max results, 1–50 (default 10)
```

### `update_content`

Updates the body (and optionally the type) of an existing document by ID.

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
  type       TEXT NOT NULL CHECK(type IN ('idea', 'spec', 'plan', 'digest')),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

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
