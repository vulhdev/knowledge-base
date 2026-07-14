---
name: knowledge-base:import
description: Import markdown files into the knowledge base. Use when the user wants to import or load existing markdown documents into the knowledge base DB. Reads KNOWLEDGE_BASE_WORKSPACE from CLAUDE.md automatically.
---

# knowledge-base:import

Import markdown files into the knowledge base database.

## How to use this skill

### 1. Read the workspace

Read `KNOWLEDGE_BASE_WORKSPACE` from `CLAUDE.md` (it is already in your context). If it is not set, stop and tell the user: "Run `npx --package @vulhdev/knowledge-base knowledge-base-init` first to set up a workspace."

### 2. Extract import parameters from the user's message

From the user's message, determine:

- **file(s)** — a file path, a glob, or a directory. If not given, ask: "Which file or folder do you want to import?"
- **feature** — the feature name to store the content under. If not given, use the filename without the `.md` extension.
- **type** — `idea`, `spec`, `plan`, or `doc`. If not given, ask the user before proceeding. Use `doc` for files that describe existing code (DB schema, flow diagrams, architecture notes).

If the user specifies a directory, list all `.md` files under it:

```bash
find <path> -name "*.md" -type f | sort
```

### 3. Import each file

For each file, read its content with the Read tool.

Extract a `title` from the file if it starts with a markdown H1 heading (`# Title text`). Use that heading text as the title and strip it from the body (the heading is redundant once stored with a title).

Then call:

```
create_content(workspace=WORKSPACE, feature=FEATURE, type=TYPE, body=<file content>, title=<title if found>)
```

Use the same type for all files unless the user specified different types per file.

### 4. Report results

```
Imported into workspace: <WORKSPACE>
  ✓ auth (spec) — id 12
  ✓ search (idea) "Full-text Search Plan" — id 13
  ✓ auth (doc) "DB Schema" — id 14
```

## Example invocations

- "import auth.md as spec" → feature=auth, type=spec
- "import docs/search.md into the search feature as an idea" → feature=search, type=idea
- "import all files in notes/ as ideas" → find all .md in notes/, type=idea for all
- "import db-schema.md as doc for auth feature" → feature=auth, type=doc, infer title from H1
