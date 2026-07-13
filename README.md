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

## Installation

### Option A: npx (no install)

```bash
npx @vulhdev/knowledge-base init
```

### Option B: Global install

```bash
npm install -g @vulhdev/knowledge-base
knowledge-base init
```

### Option C: Manual

```bash
npm install @vulhdev/knowledge-base
```

## Setup

### 1. Initialize the database

```bash
npx @vulhdev/knowledge-base init
```

This creates a `knowledge-base.db` file in your current directory and prints the MCP config snippet to paste into your Claude Code settings.

### 2. Register the MCP server

Add to your Claude Code MCP config (`.claude/mcp.json` or global settings):

```json
{
  "mcpServers": {
    "knowledge-base": {
      "command": "node",
      "args": ["/path/to/node_modules/@vulhdev/knowledge-base/dist/index.js"],
      "env": {
        "DB_PATH": "/path/to/knowledge-base.db"
      }
    }
  }
}
```

### 3. (Optional) Install Claude Code skills

Copy the skills from the `skills/` directory into your project's `.claude/skills/` folder to unlock slash commands:

| Skill | Command | Description |
|---|---|---|
| `knowledge-base-search` | `/knowledge-base-search` | Full-text search across all content |
| `knowledge-base-import` | `/knowledge-base-import` | Import content from files |
| `knowledge-base-export` | `/knowledge-base-export` | Export content to files |
| `knowledge-base-digest` | `/knowledge-base-digest` | Summarize content into a digest |

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
