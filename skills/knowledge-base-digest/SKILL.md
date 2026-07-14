---
name: knowledge-base-digest
description: Build or rebuild a digest document for a feature in the knowledge base. A digest is a single structured document (TL;DR + index) that summarizes all contents of a feature, enabling fast context loading without reading every content individually. Rebuilds are diff-aware — unchanged content entries are reused. Use when asked to digest, summarize, or index a feature, or when preparing context for a long feature with many documents.
---

# knowledge-base:digest

Build or refresh a digest for a single feature in the knowledge base.

## How to use this skill

### 1. Read the workspace

Read `KNOWLEDGE_BASE_WORKSPACE` from `CLAUDE.md`. If it is not set, tell the user to run `npx knowledge-base init` first and stop.

### 2. Identify the feature

Extract the feature name from the user's message (e.g. `/knowledge-base:digest auth` → feature = `auth`). If no feature name is given, ask for it.

### 3. Load all contents for the feature

Call `list_contents` with **no type filter** — this returns all non-digest contents:

```
list_contents(workspace=WORKSPACE, feature=FEATURE)
```

Separately, call `list_contents` with `type='digest'` to check for an existing digest:

```
list_contents(workspace=WORKSPACE, feature=FEATURE, type='digest')
```

- `sourceContents` = results from the first call
- `digestRow` = first result from the second call (or null if none)

If `sourceContents` is empty, stop and tell the user: "No contents found for feature `FEATURE`. Create some ideas, specs, or plans first."

### 4. Diff detection (only if digestRow exists)

Parse the `<!-- digest-meta: {...} -->` comment from `digestRow.body`. This is a JSON object mapping content ID (as string) to the `updated_at` snapshot from the last digest build.

```
Example: <!-- digest-meta: {"42":"2026-07-13T10:00:00","43":"2026-07-13T11:00:00"} -->
```

For each content in `sourceContents`:
- If its `id` (as string) is in the meta AND its `updated_at` equals the snapshot value → **unchanged**
- Otherwise → **changed** (new or modified)

IDs present in the meta but absent from `sourceContents` → **deleted**. Collect these for a warning.

If no `digestRow` exists, treat all `sourceContents` as **changed**.

### 5. Build the index

Create a markdown table with one row per source content.

- For **unchanged** contents: copy the existing table row verbatim from `digestRow.body`. Do not re-read or re-summarize.
- For **changed** contents: read the `body` field (already present in `sourceContents`) and write a one-line summary (≤ 15 words). Use the `title` field as the summary when it is set and descriptive enough.

Sort rows by content `id` ascending.

### 6. Generate the TL;DR

Always regenerate the TL;DR — it must reflect the full current state of the feature. Write one paragraph (3–5 sentences) that captures the purpose, key decisions, and current status of the feature based on the full index.

### 7. Assemble the digest body

```markdown
## TL;DR
{one paragraph summary}

## Index
| ID | Type | Title | Summary |
|----|------|-------|---------|
| 42 | spec |       | one-line summary |
| 43 | idea |       | one-line summary |
| 44 | doc  | DB Schema | one-line summary |

<!-- digest-meta: {"42":"2026-07-13T10:00:00","43":"2026-07-13T11:00:00","44":"2026-07-14T09:00:00"} -->
```

The `digest-meta` JSON must:
- Use each content's current `updated_at` value (from `sourceContents`)
- Use string keys (content IDs as strings)
- Be placed on the last line of the body, inside an HTML comment — preserve this format exactly so future rebuilds can parse it

Leave the `Title` cell empty (``) for contents without a title.

### 8. Save the digest

- If `digestRow` exists → call `update_content(id=digestRow.id, body=newBody)`
- If not → call `create_content(workspace=WORKSPACE, feature=FEATURE, type='digest', body=newBody)`

### 9. Respond to the user

Report:
- The full digest body
- How many contents were summarized (changed) vs reused (unchanged)
- If any deleted IDs were detected: "⚠ N content(s) removed since last digest (IDs: X, Y) — removed from index"

## Example invocations

- `/knowledge-base:digest auth` → digest feature `auth` in the current workspace
- "digest the payments feature" → feature = `payments`
- "rebuild the digest for api-design" → feature = `api-design`
- "summarize everything in the search feature" → feature = `search`

## Example digest output

```markdown
## TL;DR
The auth feature covers user login via email/password and OAuth. Key decisions include using JWT for session management and bcrypt for password hashing. The spec is finalized; implementation plan is in progress. DB schema and backend flow are documented in `doc` entries.

## Index
| ID | Type | Title | Summary |
|----|------|-------|---------|
| 12 | idea |       | Initial brainstorm: support email, Google, and GitHub login |
| 15 | spec |       | Finalized auth spec: JWT sessions, bcrypt hashing, refresh tokens |
| 18 | plan |       | Implementation plan: 6 tasks, tasks 1-3 complete |
| 21 | doc  | DB Schema | users table, sessions table, oauth_accounts table |
| 22 | doc  | Backend Flow | login → validate → issue JWT → store refresh token |

<!-- digest-meta: {"12":"2026-07-10T08:00:00","15":"2026-07-11T14:30:00","18":"2026-07-13T09:00:00","21":"2026-07-14T10:00:00","22":"2026-07-14T10:05:00"} -->
```
