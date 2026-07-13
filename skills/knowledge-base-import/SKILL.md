---
name: knowledge-base-import
description: Import markdown files into the knowledge base. Use when the user wants to migrate, import, or load existing markdown documents into the knowledge base DB. Reads KNOWLEDGE_BASE_WORKSPACE from CLAUDE.md automatically. Infers feature name and content type from file content, shows a mapping table for confirmation, and handles conflicts interactively.
---

# knowledge-base:import

Import existing markdown files into the knowledge base database.

## How to use this skill

### 1. Read the workspace

Read `KNOWLEDGE_BASE_WORKSPACE` from `CLAUDE.md` (it is already in your context). If it is not set, stop and tell the user: "Run `npx knowledge-base init` first to set up a workspace."

### 2. Identify the files

Extract the target path from the user's message — a file path, a glob pattern, or a directory. If none is given, ask: "Which files or folder do you want to import?"

Use Bash to list all `.md` files at that path:

```bash
find <path> -name "*.md" -type f | sort
```

If no `.md` files are found, tell the user and stop.

### 3. Infer metadata from path — do NOT read file content yet

**`feature`** — use the filename without the `.md` extension and without the directory path.
Examples: `notes/auth.md` → `auth`, `docs/ideas/full-text-search.md` → `full-text-search`.

**`type`** — infer from the file path or filename pattern, in this order:

1. **Directory name** — if any path segment matches: `ideas` or `idea` → `idea`, `specs` or `spec` → `spec`, `plans` or `plan` → `plan`
2. **Filename suffix** — if the filename ends with `-idea`, `-spec`, or `-plan` before `.md` → use that type
3. **Default** — if no pattern matches, use `idea` and mark the row as `⚠ uncertain`

Do not read file content to infer type. Content is only read in step 6 when actually importing.

### 4. Present the mapping table

Before writing anything, show the full proposed mapping:

```
Importing into workspace: <WORKSPACE>

  File                        Feature              Type    Notes
  ──────────────────────────────────────────────────────────────────
  notes/auth.md               auth                 spec
  notes/search.md             search               idea    ⚠ uncertain
  notes/deploy-plan.md        deploy-plan          plan

Proceed with import? (yes / adjust / cancel)
```

Wait for the user's response:
- **yes** — proceed to step 5
- **adjust** — accept corrections (e.g. "change search to spec", "rename deploy-plan to deployment") then re-show the table and ask again
- **cancel** — stop, nothing is written

### 5. Check for conflicts

For each file in the confirmed mapping, call:

```
list_contents(workspace=WORKSPACE, feature=FEATURE, type=TYPE)
```

Collect all files where a result already exists (same workspace + feature + type).

If there are conflicts, present them and ask what to do:

```
N file(s) already exist in the database:
  - auth (spec) — id 12, last updated 2026-07-10

How should conflicts be handled?
  [skip]        Leave existing DB entry unchanged, skip this file
  [overwrite]   Replace existing body with the file content
  [create new]  Insert as an additional entry (duplicate type allowed)

Apply to all conflicts, or decide per file?
```

Accept the user's choice. If they want to decide per file, ask for each conflict individually.

### 6. Execute imports

For each file to import, read its content with the Read tool immediately before calling the DB tool — do not batch-read all files first.

Then apply the mapping and conflict decisions:

- **New entry** (no conflict) → call `create_content(workspace, feature, type, body)`
- **Overwrite** → call `update_content(id=existingId, body=fileBody)`
- **Create new** (despite conflict) → call `create_content(workspace, feature, type, body)`
- **Skip** → no-op (do not read the file)

### 7. Report results

```
Import complete into workspace: <WORKSPACE>

  ✓ 3 created
  ✓ 1 overwritten
  − 2 skipped
```

## Example invocations

- "import the files in notes/" → find all .md in notes/, infer metadata, show table
- "import docs/ideas/auth.md into knowledge base" → single file import
- "load all my markdown docs from research/ into the knowledge base" → directory import
- `/knowledge-base:import ./docs` → import entire docs/ directory
