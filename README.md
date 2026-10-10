<img src="assets/kb-lockup-tagline.png" alt="knowledge-base" width="380" />

An MCP server for Claude Code that provides persistent document storage using SQLite. Organize your ideas, specs, plans, and feature documentation in a structured three-level hierarchy — track the full lineage of how ideas evolve into specs and plans, and link plans to the git commits that implement them.

```
workspace → feature → content (idea | spec | plan | digest | doc)
```

## Features

- **Persistent storage** — all content survives across Claude Code sessions
- **Five content types** — `idea`, `spec`, `plan`, `doc` (current-state feature docs), plus `digest` for summaries
- **Content lineage** — track provenance chains (`idea → spec → plan`); navigate ancestors and descendants with `get_lineage`, link documents with `link_content`, or create a derived document in one step with `derive_content`
- **Auto-suggest parents** — when creating a `spec` or `plan`, Claude automatically surfaces semantically similar parent candidates from the same workspace so you can link them without manual lookup
- **Optional title field** — short label on any document for easy scanning in list/search results
- **Semantic search** — on-device vector similarity search powered by `sqlite-vec` and a local ONNX embedding model (multilingual, 50+ languages including Vietnamese); title matches are weighted 5× above body matches; recent documents receive a small recency boost (up to +20% for today, 30-day half-life); supports pagination via `offset` so callers can page through results beyond the initial `limit`
- **Code grounding** — link plan documents to git commits at task granularity; `attach_code_ref` records which commit implements which task, `get_code_refs` returns the full coverage map, `get_content` includes a `has_code_refs` signal so Claude knows to fetch refs without a round-trip
- **Error log viewer** — every unhandled MCP tool exception is captured to SQLite and viewable in the GUI at `/errors`
- **SQLite-backed** — single file database via `better-sqlite3`, no external services
- **Content versioning** — create named snapshots of any document with `create_version`; browse the full version history with `list_versions`; `list_contents` and semantic search always show only the latest version
- **GitHub-style diff viewer** — compare any two versions of a document in the GUI at `/ws/:workspace/:feature/:id/diff?from=<id>&to=<id>`; line-level unified diff with green additions and red deletions; version compare widget on every content page with ≥ 2 versions
- **Inline review** — after saving a document, Claude opens a review session in the GUI; select any passage to add an inline comment, commit the review, and Claude processes each comment (edit, clarify, or expand) and marks it resolved — resolved comments are shown with a green badge in the GUI
- **Claude Code skills** — 14 slash commands for create, list, search, get, update, delete, import, export, explore, digest, doc analysis, review, resolve feedback, and version diff
- **Claude Code agents** — reusable agent personas installed alongside skills; `kb-conflict-resolver` provides deep conflict analysis when `semantic_contradiction` is detected

## Requirements

- Node.js 22.5 or later
- C++ build tools (for `better-sqlite3` native addon):
  - macOS: `xcode-select --install`
  - Linux: `sudo apt-get install build-essential`
  - Windows: `npm install -g windows-build-tools`

  Most users won't need this — prebuilt binaries are bundled for common platforms. If startup fails with a native addon error, run the command above then `npm rebuild better-sqlite3`.

## Setup

### 1. Install the plugin

**Recommended — via the Claude Code plugin marketplace:**

```
/plugin marketplace add vulhdev/knowledge-base
/plugin install knowledge-base
```

This registers the MCP server and installs the bundled Claude Code skills and agents in one step. Restart Claude Code afterward to pick them up.

**Manual — MCP server only:**

```bash
claude mcp add knowledge-base -- npx -y @vulhdev/knowledge-base
```

Use this if you're not using plugin marketplaces, or want to install skills and agents yourself via `init` (step 2) instead of getting them bundled automatically.

Either way, on first run the server creates `~/.claude/knowledge-base/settings.json` and stores the database at `~/.claude/knowledge-base/knowledge-base.db`.

### 2. (Optional) Initialize a workspace

To link a Claude Code project to a specific workspace, download the embedding model, and (if you used the manual install above) install skills, run:

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
4. Ask where to install **Claude Code agents**:
   - **Global** (`~/.claude/agents/`) — available in all projects
   - **This project** (`./.claude/agents/`) — current project only
   - **Skip**

After installing, restart Claude Code to pick up the new skills and agents.

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

Opens a web UI at `http://localhost:57891` (override with `PORT=<n>`). Browse workspaces → features → documents, search across all content, open the **Errors** tab to inspect recent MCP tool failures, or view a **review session** with inline comments when opened via `open_for_review`. Content pages with multiple versions show a **version compare widget** — pick any two versions and click Compare, or use "What changed?" for a one-click latest-vs-previous diff.

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
| `/review` → `knowledge-base:review` | Proactively open an existing document for inline review in the GUI — creates a review session, prints the URL, waits for the user to commit, then hands off to resolve-feedback |
| `/resolve-feedback` → `knowledge-base:resolve-feedback` | Process committed inline review comments — classifies each comment by intent (`edit_request`, `clarification`, `expand`, `positive`) and responds accordingly; marks each comment resolved via `resolve_comment` and the review via `resolve_review` |
| `/diff` → `knowledge-base:diff` | Compare any two versions of a document — resolves the version list, lets you pick two versions interactively, renders a unified diff in chat (`--- removed` / `+++ added`), and prints the GUI diff URL |

## Claude Code Agents

Agents are reusable personas installed to `~/.claude/agents/` (global) or `.claude/agents/` (project) via `init`. After installation, restart Claude Code to make them available.

| Agent | When to use |
|---|---|
| `kb-conflict-resolver` | Spawned by `/knowledge-base-create` when `semantic_contradiction` is detected — reads both conflicting docs in full, identifies the exact contradicting text, and recommends whether to update, deprecate, or mark as intentional divergence |

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

The response includes `suggested_parents` — up to 3 semantically similar documents in the same workspace that could be this document's parent. Candidates exclude the document itself, its own type, and any type known to come after it (seed `idea → spec → plan`, plus the direction learned from existing links), so custom types get suggestions too.

### `get_content`

Fetches a single document by its numeric ID. Returns all fields including `title` and `has_code_refs: boolean` — a zero-cost signal indicating whether any code refs are attached, so Claude can decide whether to call `get_code_refs` without fetching the data first.

### `list_contents`

Lists documents in a workspace, with optional filters for feature and/or type. Returns `title` on every row.

### `search_semantic`

Semantic (vector) search using a local ONNX embedding model combined with BM25 full-text search via Reciprocal Rank Fusion. Returns a `SearchPage` object — finds relevant content even when exact words don't match. Supports any natural language including Vietnamese.

Ranking signals applied in order:
- **Vector similarity** (ANN via `sqlite-vec`) + **BM25** (FTS5, title weighted 5× over body) fused with RRF
- **Recency boost** — documents updated more recently score slightly higher (max +20% today, 30-day half-life)

Requires the embedding model to be downloaded first (`npx @vulhdev/knowledge-base init`). Embeddings for new and updated documents are generated automatically; existing documents are backfilled in the background on the next server startup after `init`.

```
query      — natural language search query (any language)
workspace  — (optional) scope to a specific workspace
type       — (optional) filter by content type
limit      — max results, 1–50 (default 10)
offset     — (optional) skip first N results for pagination (default 0)
```

Returns a `SearchPage`:
```json
{
  "results":       [...],
  "has_more":      true,
  "total_in_pool": 34,
  "offset":        0,
  "limit":         10
}
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

```
id       — document ID
cascade  — (optional, default false) when true, deletes the entire version chain
```

Four deletion behaviors depending on the document's position in a version chain:
- **Sole version** — deletes the document (existing behavior, unchanged)
- **Non-root version** — deletes only that version; remaining versions are renumbered
- **Root version, `cascade=false`** — promotes v2 to root (`root_id=NULL`); other chain members updated
- **Any version, `cascade=true`** — deletes every version in the chain

---

### `create_version`

Creates a new version of an existing document. The new row gets `version_number = prev_max + 1` and `is_latest = 1`; the previous latest row is set to `is_latest = 0`. Features and content links are copied to the new version; code refs are not.

```
id    — ID of any version in the chain (root or non-root)
body  — body for the new version
type  — (optional) new type, omit to keep the same
title — (optional) new title, omit to keep the same
```

Returns a `CreateVersionResult` with the new document and `previous_version_id`.

### `list_versions`

Returns all versions in a chain sorted by `version_number ASC`. Safe to call with any version ID in the chain — always resolves to the root and returns the full list.

```
id  — ID of any version in the chain
```

Returns `{ root_id, versions: VersionSummary[] }` where each `VersionSummary` includes `id`, `version_number`, `is_latest`, `title`, `created_at`, `updated_at`.

---

### `attach_code_ref`

Links a git commit to a plan (or any document) at task granularity. Call this after each task commit so that resuming a plan in a new session immediately shows which tasks are done.

```
content_id   — ID of the plan to attach the commit to
commit_hash  — full or short git commit hash
file_paths   — array of { path, start?, end? } objects (files changed in this commit)
task_ref     — (optional) free-text label matching a task in the plan body
```

Returns the inserted `AttachCodeRefResult`. Throws if `content_id` does not exist. Throws on duplicate `(content_id, commit_hash)` — the same commit cannot be attached twice to the same plan.

### `get_code_refs`

Returns all commits linked to a document, ordered by `created_at` ascending. Use when resuming a plan to see which tasks already have commits and which don't.

```
content_id  — ID of the document to fetch code refs for
```

Returns `{ content_id, refs: AttachCodeRefResult[] }`. Returns an empty `refs` array when no refs exist — never throws.

---

### `link_content`

Links two existing documents as parent → child. Use this after both documents already exist.

```
child_id   — ID of the child document
parent_id  — ID of the parent document
```

Returns a `LinkResult` with `parent_id`, `child_id`, `created_at`, and an optional `direction_warning` if the type order is reversed (e.g. linking a `plan` as the parent of an `idea`). The warning is informational — the link is always created.

Type order is dynamic: `idea → spec → plan` is a built-in seed, and the order of any other type is learned from existing links (a pair warns only when existing links go the other way more often). The first links between new custom types produce no warning — there is no evidence yet.

### `derive_content`

Creates a new document and links it to a parent in a single atomic step. Inherits the parent's workspace and feature.

```
parent_id  — ID of the parent document to derive from
type       — type for the new document ("spec", "plan", etc.)
body       — document body text
title      — (optional) short label
```

Returns the full `CreateContentResult` plus a `parent_id` field confirming the link. The response also includes `suggested_parents` in case additional related documents exist worth linking.

---

### `open_for_review`

Creates a review session for a document and returns the GUI URL. The user opens the URL, selects text, adds inline comments, and clicks "Commit Review".

```
content_id  — ID of the document to review
port        — (optional) GUI server port, default 57891
```

Returns `{ review_id, url, note }`. Does not auto-open a browser — print the URL for the user to open manually. Start the GUI server first with `npx @vulhdev/knowledge-base gui`.

### `wait_for_review`

Long-polls SQLite every 500 ms until the user commits the review or the timeout expires.

```
content_id       — ID of the document being reviewed
timeout_seconds  — (optional) max wait time in seconds, default 300
```

Returns the committed review with all comments on success. Throws with instructions to call `/knowledge-base-resolve-feedback` on timeout.

### `get_pending_review`

Fetches the most recently committed review for a document, including all comments with their `resolved_at` state.

```
content_id  — ID of the document to fetch the review for
```

Throws if no committed review exists for the document.

### `list_contents_with_pending_review`

Lists all documents that have at least one committed (unprocessed) review. Used by `/knowledge-base-review` when `content_id` is not in context. Returns an empty array when nothing is pending.

### `resolve_comment`

Marks a single review comment as resolved after Claude has processed it. Sets `resolved_at` in the database — the GUI immediately shows the comment with a green "✓ Resolved" badge.

```
comment_id  — ID of the review_comment to mark resolved
```

### `resolve_review`

Marks an entire review as `resolved` after all comments have been processed. Only succeeds when the review is in `committed` state.

```
review_id  — ID of the review to mark resolved
```

---

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

## CLI Commands

Beyond the MCP tools, the package exposes a CLI for human developer workflows:

| Command | Description |
|---|---|
| `npx @vulhdev/knowledge-base init` | Link a project to a workspace, download embedding model, install skills and agents |
| `npx @vulhdev/knowledge-base gui` | Open browser UI at `http://localhost:57891` — browse, search, review, and compare versions |
| `npx @vulhdev/knowledge-base update` | Update installed Claude Code skills to the current version |
| `npx @vulhdev/knowledge-base link-code` | Link the current HEAD commit to a plan task |

### `link-code` subcommand

```bash
knowledge-base link-code \
  --workspace <name> \
  --feature <name> \
  --task "Task 2: Setup session middleware"

# Fallback: use numeric content ID directly
knowledge-base link-code --content-id 42 --task "Task 2"
```

Reads the HEAD commit hash and changed files from git automatically. DB path is resolved from `~/.claude/knowledge-base/settings.json` — no env var setup needed. Prints `✓ Linked commit <hash> → plan #<id> (<task>)` on success.

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
  id             INTEGER PRIMARY KEY,
  feature_id     INTEGER NOT NULL REFERENCES features(id),
  type           TEXT NOT NULL,   -- "idea" | "spec" | "plan" | "digest" | "doc"
  title          TEXT,            -- optional short label
  body           TEXT NOT NULL,
  embedding      BLOB,            -- float[384] vector, NULL until model is downloaded
  root_id        INTEGER REFERENCES contents(id),  -- NULL on v1; points to root for v2+
  version_number INTEGER NOT NULL DEFAULT 1,
  is_latest      INTEGER NOT NULL DEFAULT 1,       -- 1 for the current version, 0 for old
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Provenance graph: tracks idea→spec→plan lineage chains
CREATE TABLE content_links (
  parent_id  INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  child_id   INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (parent_id, child_id)
);

-- Links plan documents to git commits at task granularity (Migration 5)
CREATE TABLE code_refs (
  id          INTEGER PRIMARY KEY,
  content_id  INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  task_ref    TEXT,            -- free-text label matching a task in the plan body
  commit_hash TEXT NOT NULL,
  file_paths  TEXT NOT NULL,  -- JSON: [{"path": "src/auth.ts", "start": 42, "end": 89}]
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(content_id, commit_hash)
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

-- Review sessions created by open_for_review (Migration 7)
CREATE TABLE reviews (
  id           INTEGER PRIMARY KEY,
  content_id   INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',  -- "pending" | "committed" | "resolved"
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  committed_at TEXT
);

-- Inline comments added by the user in the GUI review page (Migration 7)
CREATE TABLE review_comments (
  id            INTEGER PRIMARY KEY,
  review_id     INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  selected_text TEXT,            -- passage the user highlighted (null = general comment)
  comment       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at   TEXT             -- set by resolve_comment after Claude processes it (Migration 8)
);
```

Existing databases are automatically migrated on startup:
- `title` column added if missing
- Legacy `CHECK` constraint on `type` removed (validation enforced at the application layer via Zod)
- `embedding` column added if missing; existing rows backfilled asynchronously on the next server startup after `npx @vulhdev/knowledge-base init` (model must be downloaded first)
- `content_links` table added if missing (Migration 4)
- `code_refs` table added if missing (Migration 5)
- FTS index rebuilt to include `title` column alongside `body`, with 5× BM25 column weight on title (Migration 6)
- `reviews` and `review_comments` tables added if missing (Migration 7)
- `resolved_at` column added to `review_comments` if missing (Migration 8)
- Indexes on `contents(created_at)` and `contents(type, created_at)` added if missing (Migration 10)
- `root_id`, `version_number`, `is_latest` columns added to `contents` if missing, with indexes on `root_id` and `is_latest` (Migration 11)
- Legacy database at `~/.claude/knowledge-base.db` automatically moved to `~/.claude/knowledge-base/knowledge-base.db` on first startup

## Running from a local checkout

Use this when you work on this repo, or want Claude Code to use your local build instead of the published npm package. One script prepares everything; you run it once after each reboot.

`scripts/kb-up.sh` does, in order:

1. Picks Node 22 (newest `~/.nvm/versions/node/v22.*`, else `node` on `PATH`), runs `npm install` if `node_modules` is missing or stale, and rebuilds `better-sqlite3` if it was compiled for another Node version
2. Runs `npm run build` if `src/` changed since the last build
3. Starts the MCP server once to check it answers `initialize` — this also applies every pending migration to your real database
4. Checks the embedding model is downloaded (warns only; it never downloads ~465 MB on its own)
5. Registers the MCP server in Claude Code as `kb-local`, **user scope** — available in every project folder — pointing at this checkout's `dist/bin/cli.js` with an absolute Node path
6. (Re)starts the GUI on port `57891`, detached from the terminal so closing the tab does not stop it

It then reports what is done and what, if anything, is left for you to do.

> The MCP server is not a background service. Claude Code starts its own copy each time you open a session and stops it when you quit — the script only makes sure that start succeeds.

### After every reboot — 3 steps

**1. Open a plain terminal** — not inside Claude Code.

**2. Go to the project you work on and run the script:**

```bash
cd /path/to/your-project
/path/to/knowledge-base/scripts/kb-up.sh
```

**3. At the last question, press Enter:**

```
Open a Claude Code session in /path/to/your-project now?
  y / Enter → yes, this terminal becomes that session
  n         → no; everything stays ready, open sessions yourself later
[Y/n]
```

Claude Code opens in your project with the knowledge-base tools available. Paths to your project's code and docs stay relative to your project.

**More sessions at the same time:** open a new terminal tab and run `cd /path/to/your-project && claude`. Do not re-run the script — once per reboot is enough. All sessions share one database and one GUI.

**Do not run the script from inside Claude Code** (for example with `!`): Claude Code's sandbox blocks the GUI from opening its port, and a session is already open anyway.

### Other commands

```bash
scripts/kb-up.sh --no-launch   # prepare everything, never ask to open Claude Code
scripts/kb-up.sh status        # show what is running; changes nothing
scripts/kb-up.sh stop          # stop the GUI
```

### After pulling new code

Run `scripts/kb-up.sh` again. It rebuilds, and if Claude Code sessions are still running the old build it tells you to type `/mcp` → `kb-local` → **Reconnect** in each of them.

### Notes

- macOS only for now — the script uses BSD `stat` / `date` and `lsof`.
- If you also installed the plugin (`/plugin install knowledge-base`), Claude Code runs both servers against the same database and lists each tool twice, once per server. Disable one of them.
- Which workspace a project uses comes from the `KNOWLEDGE_BASE_WORKSPACE=<name>` line in that project's `CLAUDE.md` (written by `init`).

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
