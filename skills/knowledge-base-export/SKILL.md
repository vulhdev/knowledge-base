---
name: knowledge-base:export
description: Export knowledge base contents to markdown files. Use when the user wants to export, dump, or save knowledge base documents as markdown files. Reads KNOWLEDGE_BASE_WORKSPACE from CLAUDE.md automatically.
---

# knowledge-base:export

Export knowledge base contents to markdown files on disk.

## How to use this skill

### 1. Read the workspace

Read `KNOWLEDGE_BASE_WORKSPACE` from `CLAUDE.md` (it is already in your context). If it is not set, stop and tell the user: "Run `npx --package @vulhdev/knowledge-base knowledge-base-init` first to set up a workspace."

### 2. Extract export parameters from the user's message

From the user's message, determine:

- **outdir** — output directory. Default: `docs/` relative to current working directory.
- **feature** — optional, to export only one feature. If not mentioned, export all features.

### 3. Load contents

Call `list_contents(workspace=WORKSPACE)` — or with `feature=FEATURE` if the user specified one.

Filter out any content with `type=digest`. If nothing remains, tell the user and stop.

### 4. Write files

For each content entry, determine the output path:

```
{outdir}/{type}/{feature}.md
```

If a `doc` entry has a `title`, use a slugified version of the title as the filename to make docs distinguishable:
```
{outdir}/doc/{feature}-{slug(title)}.md
```

If two entries would produce the same filename, append the content ID to avoid collision:
```
{outdir}/{type}/{feature}-{id}.md
```

Use Bash to create directories as needed:

```bash
mkdir -p <parent directory>
```

Write each file with the Write tool. If the entry has a title, prepend it as an H1 heading before the body:

```markdown
# {title}

{body}
```

Otherwise write the body as-is.

### 5. Report results

```
Exported workspace: <WORKSPACE> → docs/
  ✓ docs/spec/auth.md (id 12)
  ✓ docs/idea/search.md (id 13)
  ✓ docs/doc/auth-db-schema.md (id 21, "DB Schema")
  ✓ docs/doc/auth-backend-flow.md (id 22, "Backend Flow")
```

## Example invocations

- "export my knowledge base to docs/" → export all to docs/
- "export the auth feature" → feature=auth, outdir=docs/
- "dump everything to markdown files" → export all, outdir=docs/
