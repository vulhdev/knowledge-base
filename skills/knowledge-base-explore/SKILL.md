---
name: knowledge-base:explore
description: >
  Proactively load knowledge-base context for a specific feature before starting work.
  Use this skill when ALL of the following are true:
  (1) the user names a specific feature to implement, design, review, or debug;
  (2) you do not already have knowledge-base context for that feature in this conversation;
  (3) the task requires understanding prior decisions, specs, or plans — not just reading code.
  Do NOT use if context was already loaded this session, the question is conceptual with no feature named,
  or the user is asking a quick follow-up in an ongoing conversation.
---

# knowledge-base:explore

Load prior knowledge for a feature before starting work — fast by default, deep when needed.

## When to invoke

Invoke this skill **proactively** (without the user asking) when you are about to work on a named feature and have not yet loaded its knowledge-base context this session.

**Invoke when:**
- User says "implement X", "design X", "review X", "debug X", or similar action + feature name
- Starting a new task that touches a specific feature

**Do NOT invoke when:**
- You already explored this feature earlier in the same conversation
- The user asks a quick conceptual question with no specific feature named
- Context is already present in the conversation (e.g. user pasted a spec inline)
- The feature has no meaningful name (e.g. "this function", "the bug")

---

## How to use this skill

### Step 0: Read the workspace

Read `KNOWLEDGE_BASE_WORKSPACE` from `CLAUDE.md`. If not set, skip this skill silently — do not interrupt the user to ask for setup.

Extract the feature name from the user's message or the current task context.

### Step 1: Quick scan via digest (always run first)

Call `search_content` scoped to digests only:

```
search_content(query=<feature>, workspace=WORKSPACE, type="digest", limit=3)
```

**If digest results are found:**
- Read each digest's `body` — it contains a TL;DR paragraph and an index table
- Present a compact summary to orient yourself:
  - The TL;DR (1 paragraph)
  - The index table (ID | Type | Title | Summary)
- In **quick mode** (default), stop here. You now have enough context to begin work.

**If no digest results are found** → proceed to Step 2.

### Step 2: Fallback — full-text search (only if Step 1 found nothing)

Run two searches in parallel:

```
search_content(query=<feature>, workspace=WORKSPACE, type="doc", limit=5)
search_content(query=<feature>, workspace=WORKSPACE, limit=10)
```

**`doc` results are highest priority** — they describe the current state of the feature (DB schema, backend flow, frontend). Load their full bodies via `get_content` before presenting results.

Present combined results grouped by type, showing title when available:

```
📚 Knowledge-base context for `<feature>` (no digest — raw search results):

**Docs (current state):**
- [#12 · doc] "DB Schema" — contents of body...
- [#18 · doc] "Backend Flow" — contents of body...

**Other:**
- [#31 · spec] Short excerpt from body...
- [#44 · plan] Short excerpt from body...
```

If this also returns nothing, proceed without knowledge-base context and note it briefly:
> "No prior knowledge found for feature `<feature>`. Starting fresh."

### Step 3: Deep mode (only when explicitly needed)

Enter deep mode when:
- Quick mode returned a digest index but you need the **full body** of a specific spec, plan, or doc to implement something
- The user explicitly asks to "read the full spec" or "load the full doc"

For each relevant content ID from the index:
```
get_content(id=<id>)
```

Load only the IDs that are directly relevant to the current task — not all of them. `doc` types are usually the most valuable to load in full when implementing.

---

## Output format

Keep the output **concise** — this is context loading, not a report. Aim for one short block:

```
📚 Knowledge-base context for `<feature>`:

**TL;DR:** <digest TL;DR paragraph>

| ID | Type | Title | Summary |
|----|------|-------|---------|
| 42 | spec |       | ... |
| 43 | plan |       | ... |
| 44 | doc  | DB Schema | ... |
```

If fallback search was used (no digest):
```
📚 Knowledge-base context for `<feature>` (no digest — raw search results):

**Docs (current state):**
- [#12 · doc] "DB Schema" — <full body loaded>
- [#18 · doc] "Backend Flow" — <full body loaded>

**Other:**
- [#31 · spec] Short excerpt from body...
```

If nothing found:
```
📚 No prior knowledge found for `<feature>`. Starting fresh.
```

---

## Decision table

| Situation | Action |
|---|---|
| Digest found | Present TL;DR + index (include title column), stop (quick mode) |
| Digest found + need full content | Load specific IDs via `get_content` (deep mode); prioritize `doc` types |
| No digest, doc results found | Load full body of each doc, present as "current state" context |
| No digest, no docs, other results | Present raw search results |
| Nothing found | Note it briefly, proceed with task |
| Workspace not configured | Skip silently |
| Already explored this session | Skip — don't call again |

---

## Example scenarios

**"Implement the auth refresh token flow"**
→ `search_content(query="auth", type="digest")` → find digest → read TL;DR + index → load `get_content(15)` (the auth spec) because implementing requires the full spec → proceed with implementation

**"Implement tính năng tạo bài viết"**
→ `search_content(query="bài viết", type="digest")` → no digest → parallel: `search_content(type="doc")` finds "DB Schema" + "Backend Flow" → load both via `get_content` → present full current-state context → proceed

**"Review the search feature"**
→ `search_content(query="search", type="digest")` → find digest → present TL;DR + index → done (quick mode, review doesn't need full bodies)

**"Debug the payment webhook"**
→ `search_content(query="payment", type="digest")` → no digest → parallel search finds a `doc` "Payment Webhook Flow" → load full body → present as primary context → proceed

**"What is dependency injection?"**
→ Conceptual question, no feature named → **do not invoke this skill**
