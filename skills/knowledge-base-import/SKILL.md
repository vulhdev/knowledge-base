---
name: knowledge-base:import
description: Import markdown files into the knowledge base. Use when the user wants to import or load existing markdown documents into the knowledge base DB. Reads KNOWLEDGE_BASE_WORKSPACE from CLAUDE.md automatically.
---

# knowledge-base:import

Import markdown files into the knowledge base database.

## How to use this skill

### 1. Read the workspace

Read `KNOWLEDGE_BASE_WORKSPACE` from `CLAUDE.md` (it is already in your context). If it is not set, stop and tell the user: "Run `npx @vulhdev/knowledge-base init` first to set up a workspace."

### 2. Extract import parameters from the user's message

From the user's message, determine:

- **file(s)** — a file path, a glob, or a directory. If not given, ask: "Which file or folder do you want to import?"
- **feature** — the feature name to store the content under. If not given, use the filename without the `.md` extension.
- **type** — any string. Suggested values: `idea`, `spec`, `plan`, `doc`. If not given in the user's message, default to `doc`. Use `doc` for files that describe existing code (DB schema, flow diagrams, architecture notes).

If the user specifies a directory, list all `.md` files under it:

```bash
find <path> -name "*.md" -type f | sort
```

### 3. Import each file

For each file, read its content with the Read tool.

Determine the title using this priority order:

1. **H1 heading** — if the file starts with `# Title text`, use that text as the title and strip the heading line from the body (it is redundant once stored with a title).
2. **AI-generated** — if no H1 heading is found, read the body and generate a short title (≤ 10 words) that captures the main subject. Use the same language as the body. Prefer noun phrases (e.g. "OAuth2 Token Refresh Flow", "Kế hoạch triển khai auth"). Do not include the content type in the title.

Always pass a title — never leave it null for imported files.

Then call:

```
create_content(workspace=WORKSPACE, feature=FEATURE, type=TYPE, body=<file content>, title=<title>)
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
