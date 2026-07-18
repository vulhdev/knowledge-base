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
2. **AI-generated** — if no H1 heading is found, read the body and generate a short title (≤ 10 words) that captures the main subject. Use the same language as the body. Prefer noun phrases (e.g. "OAuth2 Token Refresh Flow", "Auth Deployment Plan"). Do not include the content type in the title.

Always pass a title — never leave it null for imported files.

Then call:

```
create_content(workspace=WORKSPACE, feature=FEATURE, type=TYPE, body=<file content>, title=<title>)
```

Use the same type for all files unless the user specified different types per file.

### 4. Suggest links (optional)

After all files are saved, suggest relationships between the imported docs and existing content. Do this **once at the end**, not per file.

**Structural links — check first:**
If the imported files come from folders that map to types (e.g. `ideas/`, `specs/`, `plans/`), detect the chain for each feature:

- Group saved docs by feature name
- If the same feature has docs of type `idea`, `spec`, and/or `plan`, suggest linking them as `idea → spec → plan` (parent → child)

Example:
```
Detected linkable chain:
  auth: idea #7 → spec #12 → plan #15
  Create these 2 links?
```

**Semantic links — run in parallel with structural check:**
For each imported file, call `search_semantic` using its title + first 300 chars of body to find related existing docs (not the ones just imported). Collect all results, deduplicate, then present together.

Present all suggestions in one block:
```
Suggested links — select which ones to create:
  [ ] #7 auth/idea → #12 auth/spec (structural chain)
  [ ] #12 auth/spec → #3 auth/idea "Prior Auth Research" (semantic)
  [ ] #13 search/idea → #5 search/spec "Search API Contract" (semantic)
```

**If the user confirms multiple links, call all `link_content` in parallel in one response** — do not await each call sequentially.

### 5. Report results

```
Imported into workspace: <WORKSPACE>
  ✓ auth (spec) "OAuth2 Token Refresh Flow" — id 12
  ✓ search (idea) "Full-text Search Plan" — id 13
  ✓ auth (doc) "DB Schema" — id 14

Links created:
  ✓ #7 → #12 (idea → spec)
  ✓ #12 → #15 (spec → plan)
```

## Example invocations

- "import auth.md as spec" → feature=auth, type=spec
- "import docs/search.md into the search feature as an idea" → feature=search, type=idea
- "import all files in notes/ as ideas" → find all .md in notes/, type=idea for all
- "import db-schema.md as doc for auth feature" → feature=auth, type=doc, infer title from H1
