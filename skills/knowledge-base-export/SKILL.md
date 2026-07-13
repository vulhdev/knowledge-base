---
name: knowledge-base-export
description: Export knowledge base contents to markdown files. Use when the user wants to export, dump, backup, or save their knowledge base documents as markdown files. Reads KNOWLEDGE_BASE_WORKSPACE from CLAUDE.md automatically. Writes one file per content entry, warns before overwriting existing files.
---

# knowledge-base:export

Export knowledge base contents to markdown files on disk.

## How to use this skill

### 1. Read the workspace

Read `KNOWLEDGE_BASE_WORKSPACE` from `CLAUDE.md` (it is already in your context). If it is not set, stop and tell the user: "Run `npx knowledge-base init` first to set up a workspace."

### 2. Resolve scope

Extract from the user's message:

- **`outdir`** — output directory for markdown files. Default: `docs/` (relative to current working directory).
- **`feature`** — optional filter to export only one feature. If not mentioned, export all features.

### 3. Load contents

Call `list_contents` with no type filter to get all non-digest contents:

```
list_contents(workspace=WORKSPACE, feature=FEATURE_OR_OMIT)
```

Then call again with `type='digest'` and collect those IDs separately — digests are excluded from export.

Filter out any content whose `type` is `digest`.

If no contents remain, tell the user: "No contents found for workspace `WORKSPACE`." and stop.

### 4. Resolve output paths

Map each content to a file path using this convention:

| Type | Output path |
|------|-------------|
| `idea` | `{outdir}/ideas/{feature}.md` |
| `spec` | `{outdir}/specs/{feature}.md` |
| `plan` | `{outdir}/plan/{feature}.md` |

If a feature has **more than one content of the same type**, append the content ID to avoid collision:
- `{outdir}/ideas/{feature}-{id}.md`

Example:
```
Content 12: workspace=kb, feature=auth, type=spec  → docs/specs/auth.md
Content 14: workspace=kb, feature=auth, type=spec  → docs/specs/auth-14.md  (collision)
Content 15: workspace=kb, feature=auth, type=idea  → docs/ideas/auth.md
```

### 5. Preview and conflict check

Before writing anything, show the export plan:

```
Exporting workspace: <WORKSPACE> → docs/

  docs/ideas/auth.md             (id 15)
  docs/specs/auth.md             (id 12)
  docs/specs/auth-14.md          (id 14)
  docs/plan/auth.md              (id 18)
  docs/ideas/search.md           (id 20)

5 files to write.
```

Use Bash to check which output paths already exist:

```bash
ls <each output path> 2>/dev/null
```

If any files already exist, warn before proceeding:

```
These files already exist and will be overwritten:
  docs/specs/auth.md
  docs/ideas/search.md

Continue? (yes / skip existing / cancel)
```

- **yes** — overwrite all existing files
- **skip existing** — write only new files, leave existing untouched
- **cancel** — stop, nothing is written

### 6. Write files

For each content to write:

1. Use Bash to create the parent directory if it doesn't exist:
   ```bash
   mkdir -p <parent directory>
   ```
2. Write the file with the Write tool. The body is written as-is — no frontmatter, no metadata added.

### 7. Report results

```
Export complete → docs/

  ✓ 4 files written
  − 1 skipped (already existed)
```

## Output format

Files are written as plain markdown with no modifications to the body. What is in the DB is exactly what lands on disk — no frontmatter, no headers added by the skill.

## Example invocations

- "export my knowledge base to docs/" → export all contents of current workspace to docs/
- "export the auth feature to markdown" → export only feature=auth, outdir=docs/
- "backup the knowledge base to backup/kb/" → outdir=backup/kb/
- "dump everything to markdown files" → export all, outdir=docs/
- `/knowledge-base:export ./output` → export all to output/ directory
- `/knowledge-base:export auth` → export only the auth feature to docs/
