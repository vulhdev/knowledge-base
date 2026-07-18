# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Session-aware parent linking in `knowledge-base-create`** — scans conversation history for docs saved earlier in the session; if the type chain is valid (`idea→spec`, `spec→plan`), asks the user to link and uses `derive_content` to create and link atomically (Step 5b)
- **Conflict-aware save flow in `knowledge-base-create`** — after `create_content`, checks `conflicts[]` in the response; `semantic_contradiction` fetches an excerpt and prompts the user to link the conflicting doc; `risk_shadow` is surfaced as a note in the Step 8 report without interrupting the flow (Step 6b)

### Fixed
- `CLAUDE.md` `Always Do` section now invokes `/knowledge-base-create` skill instead of calling `create_content` directly; added `Never Do` guard to prevent bypassing the full save flow (conflict detection, link suggestion, feature selection)

### Changed
- Skills & MCP Tools table in the `init` block expanded from 5 to 11 entries to match `src/tools/` — added `delete_content`, `link_content`, `derive_content`, `get_lineage`, `attach_code_ref`, `get_code_refs`

## [1.10.3] — 2026-07-18

### Added
- `knowledge-base-link` skill — manually links two existing documents by ID with direction inference and `direction_warning` handling
- **Auto-linking in `knowledge-base-create`** — after saving, suggests related docs via `search_semantic` and prompts the user to link with correct `idea→spec→plan` direction
- **Auto-linking in `knowledge-base-import`** — detects structural chains from folder layout and semantic similarity at the end of a batch import; calls `link_content` in parallel

## [1.10.2] — 2026-07-18

### Changed
- Updated README to document v1.9.0 settings config and v1.10.0 code grounding features

## [1.10.1] — 2026-07-18

### Changed
- Updated CHANGELOG to document v1.9.0 and v1.10.0 releases

## [1.10.0] — 2026-07-18

### Added
- **Code grounding** — link plan documents to git commits at task granularity; enables Claude to resume a plan in a new session and immediately know which tasks already have commits
- `attach_code_ref` tool — records a commit hash and changed files against a plan (or any content), with an optional `task_ref` label matching a task in the plan body; `UNIQUE(content_id, commit_hash)` prevents duplicate entries
- `get_code_refs` tool — returns all commits linked to a document ordered by `created_at`, parsed as `{ content_id, refs: AttachCodeRefResult[] }`; returns an empty `refs` array (never throws) when no refs exist
- `has_code_refs: boolean` field on `get_content` response — zero-cost signal (EXISTS subquery) letting Claude decide whether to call `get_code_refs` without a separate round-trip
- `kb link-code` CLI subcommand — resolves `content_id` from `--workspace` / `--feature` names (or `--content-id` fallback), reads HEAD commit hash and changed files from git, and writes a `code_refs` row directly to SQLite; no env var setup required since DB path is read from `~/.claude/knowledge-base/settings.json`
- `code_refs` table (Migration 5) — stores per-task commit references with `file_paths` as a JSON array of `{ path, start?, end? }` objects; CASCADE delete keeps refs in sync when content is removed
- `CodeRefFile`, `AttachCodeRefResult`, `GetCodeRefsResult` types exported from `types.ts`

## [1.9.0] — 2026-07-18

### Added
- **Settings config** — DB path and model cache dir are now persisted in `~/.claude/knowledge-base/settings.json`; env vars (`DB_PATH`, `MODEL_CACHE_DIR`) are read once on first startup to seed the file and never consulted again
- Automatic migration of the legacy database from `~/.claude/knowledge-base.db` to `~/.claude/knowledge-base/knowledge-base.db` on first startup; cross-device move handled via copy + delete fallback

### Changed
- `DB_PATH` env var no longer required after initial setup; MCP config can be simplified to remove it once `settings.json` is written
- `MODEL_CACHE_DIR` env var replaced by `model_cache_dir` in `settings.json`

## [1.8.0] — 2026-07-18

### Added
- **Content lineage graph** — track provenance chains between `idea`, `spec`, and `plan` documents
- `link_content` tool — links two existing documents as parent → child; emits `direction_warning` when type order is reversed but never blocks the operation
- `derive_content` tool — creates a new document and links it to a parent atomically in a single step; inherits parent's workspace and feature
- `get_lineage` tool — returns the full ancestry chain for a document (all ancestors nearest→oldest, all descendants in BFS order)
- `suggested_parents` field on `create_content` and `derive_content` responses — automatically surfaces up to 3 semantically similar parent candidates from the same workspace using vector search (with FTS fallback when the embedding model is not loaded)
- `content_links` table (Migration 4) — junction table with composite PK and CASCADE delete for storing lineage links

## [1.7.0] — 2026-07-18

### Added
- **Conflict detection** — `create_content` now detects semantic contradictions and risk shadows against existing documents in the same workspace using MCP sampling; conflicts are returned in the response alongside the new document
- **Error log viewer** — every unhandled MCP tool exception is captured to a new `error_logs` SQLite table; viewable in the GUI at `/errors`
- MCP sampling capability registered on the server; `requestSampling` wired into the conflict detection pipeline

### Changed
- `create_content` response now includes a `conflicts` field (array of `ConflictResult`)

## [1.6.1] — 2026-07-18

### Fixed
- Corrected the embedding model cache path to include the `Xenova/` prefix; model was not found after download in some environments

## [1.6.0] — 2026-07-18

### Added
- **Semantic search** — new `search_semantic` tool replaces `search_content`; uses on-device vector similarity (sqlite-vec KNN) powered by the `paraphrase-multilingual-MiniLM-L12-v2` ONNX model (multilingual, 50+ languages including Vietnamese)
- `embedding` column on `contents` table (Migration 3); embeddings generated on insert and regenerated on update
- Async backfill of embeddings for existing documents on server startup (after model is downloaded)
- Model download step added to `npx @vulhdev/knowledge-base init`; model cached at `~/.cache/knowledge-base/models/`
- `MODEL_CACHE_DIR` env var to override the model cache location
- Intent-aware output in the `knowledge-base:explore` skill

### Changed
- Replaced `node:sqlite` with `better-sqlite3` for improved compatibility and native addon support
- `ContentType` relaxed to `string` — any non-empty string is accepted; Zod `z.enum` replaced with `z.string().min(1)` across all MCP tools
- `search_content` (FTS-based) replaced by `search_semantic` (vector-based)

## [1.5.5] — 2026-07-16

### Fixed
- Updated GUI logo to tagline-dark variant; fixed asset packaging and increased logo height to 50px

## [1.5.4] — 2026-07-16

### Added
- Logo added to GUI header and README

## [1.5.3] — 2026-07-16

### Added
- `knowledge-base:normalize` skill — normalizes and backfills the `title` field on import

## [1.5.2] — 2026-07-16

### Fixed
- GUI now auto-finds an available port if the preferred port is already in use
- Fixed GUI defaulting `DB_PATH` to `~/.claude/knowledge-base.db` when env var is not set

## [1.5.1] — 2026-07-16

### Added
- `npx @vulhdev/knowledge-base update` command — refreshes installed skills when a new version is released; auto-detects skills in `~/.claude/skills/` and `./.claude/skills/`

## [1.5.0] — 2026-07-16

### Changed
- Refactored CLI from separate bin entries to a single dispatcher (`npx @vulhdev/knowledge-base [mcp|gui|init|update]`)
- Fixed: `npx @vulhdev/knowledge-base` with no subcommand now correctly starts the MCP server

## [1.4.0] — 2026-07-15

### Added
- **GUI web server** — `npx @vulhdev/knowledge-base gui` opens a read-only browser UI at `http://localhost:3000` (override with `PORT=<n>`) for browsing workspaces → features → documents and searching across all content

## [1.3.0] — 2026-07-15

### Added
- `npx @vulhdev/knowledge-base init` now injects a full `knowledge-base` CLAUDE.md block into the project's `CLAUDE.md`, providing Claude Code with workspace context on every session

## [1.2.4] — 2026-07-15

### Fixed
- CI: reverted to Granular Access Token for npm auth after OIDC issues

## [1.2.3] — 2026-07-15

### Fixed
- CI: removed `registry-url` from release workflow to fix OIDC auth conflict

## [1.2.2] — 2026-07-15

### Changed
- CI: switched npm publish to Trusted Publishing (OIDC)

## [1.2.1] — 2026-07-15

### Added
- GitHub Actions workflows for CI (test on push/PR) and automated npm release on version tag

## [1.2.0] — 2026-07-15

### Added
- `title` field (optional) on all content types — short label displayed in list and search results
- `doc` content type — for current-state feature documentation (DB schema, backend flow, frontend)
- `delete_content` MCP tool — permanently deletes a document by ID
- `knowledge-base:doc` skill — analyzes a codebase feature and saves structured documentation
- `knowledge-base:list` skill — browses all documents in a feature without a keyword

### Changed
- All skills switched to colon namespace notation (`/knowledge-base:create`, `/knowledge-base:search`, etc.)
- Skills updated to handle `title` field and `doc` type

## [1.1.0] — 2026-07-13

### Added
- `knowledge-base:explore` skill — proactively loads feature context before starting work
- `knowledge-base:import` and `knowledge-base:export` skills
- `knowledge-base:digest` skill — builds a TL;DR + index summary for a feature
- `knowledge-base:search` skill — semantic search over stored documents
- `knowledge-base:create` skill — saves conversation output to the knowledge base
- `digest` content type — one-per-feature summary document; hidden from default list views
- Auto-install of Claude Code skills via `npx @vulhdev/knowledge-base init` wizard (global or project-local)
- Default `DB_PATH` to `~/.claude/knowledge-base.db`; simplified MCP registration to a single `claude mcp add` command
- `update_content` MCP tool — updates body, type, and title of an existing document
- `search_content` MCP tool — FTS5 BM25 full-text search across document bodies
- `init` CLI wizard powered by `@clack/prompts` for workspace selection and skill installation

## [1.0.0] — 2026-07-13

### Added
- Initial release
- SQLite-backed storage with a three-level hierarchy: `workspace → feature → content`
- `create_content`, `get_content`, `list_contents` MCP tools
- FTS5 full-text search index with INSERT/UPDATE/DELETE triggers
- TypeScript project with `better-sqlite3`, Zod, `@modelcontextprotocol/sdk`, and Vitest

[Unreleased]: https://github.com/vulhdev/knowledge-base/compare/v1.10.3...HEAD
[1.10.3]: https://github.com/vulhdev/knowledge-base/compare/v1.10.2...v1.10.3
[1.10.2]: https://github.com/vulhdev/knowledge-base/compare/v1.10.1...v1.10.2
[1.10.1]: https://github.com/vulhdev/knowledge-base/compare/v1.10.0...v1.10.1
[1.10.0]: https://github.com/vulhdev/knowledge-base/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/vulhdev/knowledge-base/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/vulhdev/knowledge-base/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/vulhdev/knowledge-base/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/vulhdev/knowledge-base/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/vulhdev/knowledge-base/compare/v1.5.5...v1.6.0
[1.5.5]: https://github.com/vulhdev/knowledge-base/compare/v1.5.4...v1.5.5
[1.5.4]: https://github.com/vulhdev/knowledge-base/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/vulhdev/knowledge-base/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/vulhdev/knowledge-base/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/vulhdev/knowledge-base/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/vulhdev/knowledge-base/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/vulhdev/knowledge-base/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/vulhdev/knowledge-base/compare/v1.2.4...v1.3.0
[1.2.4]: https://github.com/vulhdev/knowledge-base/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/vulhdev/knowledge-base/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/vulhdev/knowledge-base/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/vulhdev/knowledge-base/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/vulhdev/knowledge-base/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/vulhdev/knowledge-base/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/vulhdev/knowledge-base/releases/tag/v1.0.0
