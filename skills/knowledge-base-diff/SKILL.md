---
name: knowledge-base:diff
description: Compare two versions of a knowledge-base document. Shows a unified diff in chat (--- removed / +++ added) and a clickable GUI URL for the visual view. Use when the user asks "what changed?", "so sánh 2 phiên bản", "diff v1 vs v3", or invokes /knowledge-base-diff [id].
---

# knowledge-base:diff

Compare any two versions of a document — renders a unified diff in chat and provides the GUI diff URL.

## When to use

- User says "what changed in this doc?", "diff v1 vs v2", "so sánh phiên bản", or similar
- User explicitly invokes `/knowledge-base-diff` (with or without an ID argument)
- A `get_content` response shows `version_count >= 2` and the user asks about changes

## Steps

### 1. Resolve the document ID

**If an ID is provided** (e.g. `/knowledge-base-diff 42`) → use it directly.

**If not provided:**
1. Call `list_contents(workspace=WORKSPACE)` to browse documents
2. Filter to docs that likely have versions (any doc is eligible)
3. Ask:

```
AskUserQuestion: "Which document do you want to diff?"
Options (up to 4 most recently updated):
  ● #83 · diff-viewer-demo/spec "Search Feature Spec"
  ○ #79 · content-versioning/plan "Plan: Content Versioning"
  ○ #78 · content-versioning/spec "Spec: Content Versioning"
```

### 2. Load version list

Call `list_versions(id=<resolved_id>)`.

**If the chain has only 1 version:**
```
Document #<id> has only one version — nothing to diff yet.
To create a new version: create_version(<id>)
```
Then stop.

**If 2+ versions exist:** proceed to Step 3.

### 3. Select versions to compare

Display the full version list in text so the user can read it:

```
Versions of #<id> "<title>":
  v1 — Jan 5, 2026  (id: 83)
  v2 — Jan 8, 2026  (id: 84)
  v3 — Jan 12, 2026 (id: 85) ← latest
```

Then use `AskUserQuestion` to select the **from** version.

Build the options from the version list:
- First option: the **shortcut** "Latest vs Previous" (`v{N-1} → v{N}`) — precomputes the most common comparison
- Remaining options (up to 3): individual version entries formatted as `v{N} — {date} ({id})`

Example with 3 versions:
```
AskUserQuestion: "Compare from which version?"
  ● Latest vs Previous — v2 Jan 8 → v3 Jan 12 (shortcut)
  ○ v1 — Jan 5, 2026  (id: 83)
  ○ v2 — Jan 8, 2026  (id: 84)
```

**If user picks the shortcut** → `from = second-latest`, `to = latest`, skip to Step 4.

**If user picks a specific "from" version** → ask a follow-up for `to`:
```
AskUserQuestion: "Compare to which version?"
  ● v3 — Jan 12, 2026 (latest)  (id: 85)
  ○ v2 — Jan 8, 2026  (id: 84)
  ○ v1 — Jan 5, 2026  (id: 83)
```

Exclude the selected `from` version from this list. Default to the latest.

### 4. Fetch both versions

Call `get_content(id=<from_id>)` and `get_content(id=<to_id>)` in parallel.

### 5. Render unified diff in chat

Compare the two bodies line by line and produce a unified diff block.

Format:
````
```diff
--- v{N}  {from_date}
+++ v{M}  {to_date}

 <unchanged context line>
-<removed line>
+<added line>
 <unchanged context line>
```
````

Rules:
- Show **3 lines of context** around each changed section (like `git diff`)
- If two change sections are closer than 3 lines apart, merge them into one hunk
- Prefix each line: ` ` (space) for context, `-` for removed, `+` for added
- If bodies are identical: print `No differences between v{N} and v{M}.` instead of the block
- Keep the diff block to a reasonable length — if the total changed lines exceed ~60, summarize: show the first 30 changed lines then print `... <N more changed lines> — open GUI for full view`

### 6. Print GUI URL

Always print the GUI URL after the diff block:

```
🔍 Visual diff: http://localhost:57891/ws/<workspace>/<feature>/<root_id>/diff?from=<from_id>&to=<to_id>
   (Start GUI first if not running: npx @vulhdev/knowledge-base gui)
```

Use `from.workspace`, `from.features[0]`, and `from.root_id ?? from.id` to build the URL.

## Example output

```
Versions of #83 "Search Feature Spec":
  v1 — Oct 7, 2026  (id: 83)
  v2 — Oct 8, 2026  (id: 84)
  v3 — Oct 9, 2026  (id: 85) ← latest
```

After selection:

````
```diff
--- v2  Oct 8, 2026
+++ v3  Oct 9, 2026

 ## Requirements
 - Full-text BM25 search across documents
 - Semantic vector search (ANN, 384-dim embeddings)
+- Reciprocal Rank Fusion (k=60) to merge BM25 + ANN results
+- Recency boost: max +20%, 30-day half-life
 - Filter by workspace and feature
 - Return top 10 results ranked by relevance
+- Return top 10 results ranked by combined score

+## Non-Functional Requirements
+- P95 latency < 200ms for a 10k-doc corpus
+
 ## Out of Scope
 - Spell correction
-- Multi-language support
```
````

```
🔍 Visual diff: http://localhost:57891/ws/demo/diff-viewer-demo/83/diff?from=84&to=85
   (Start GUI first if not running: npx @vulhdev/knowledge-base gui)
```

## Notes

- `list_versions` resolves the full chain from any version ID — safe to pass non-root IDs
- `get_content` returns `version_number`, `root_id`, `created_at` — all needed to build the URL
- The `diff` code fence renders with green/red syntax highlighting in VS Code, GitHub, and most markdown viewers
