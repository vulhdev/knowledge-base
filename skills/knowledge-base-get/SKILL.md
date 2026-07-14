---
name: knowledge-base:get
description: Retrieve and display the full content of a specific document from the knowledge base. Use when the user wants to read, view, or open a stored document — e.g. "lấy spec auth", "đọc plan của feature search", "show me the idea we saved for X", "xem lại content ID 42". Distinct from knowledge-base-search (which shows excerpts) — this fetches and displays the complete body.
---

# knowledge-base:get

Retrieve the full content of a document from the knowledge base.

## How to use this skill

### 1. Read the workspace

Read `KNOWLEDGE_BASE_WORKSPACE` from `CLAUDE.md` (it is already in your context). If it is not set, stop and tell the user: "Run `npx --package @vulhdev/knowledge-base knowledge-base-init` first to set up a workspace."

### 2. Identify the target document

**Case A — user provides a numeric ID directly** (e.g. "get ID 42", "xem content #7"):
→ Skip to Step 4. Call `get_content(id=<id>)` immediately.

**Case B — user provides feature and/or type** (e.g. "lấy spec của auth", "đọc plan search"):
→ Call `list_contents(workspace=WORKSPACE, feature=<feature>, type=<type>)` with the known filters.

**Case C — user describes topic without explicit feature/type** (e.g. "lấy cái document về deployment", "show me what we have on caching"):
→ Extract keywords from the message and call `search_content(query=<keywords>, workspace=WORKSPACE, limit=10)`.

### 3. Resolve to a single document (if needed)

**If exactly 1 result:** proceed directly to Step 4 — no need to ask.

**If multiple results:** present a concise list and ask the user to pick. Show title when available:

```
Tìm thấy nhiều documents — bạn muốn xem cái nào?

  1. [#12 · spec · auth] "DB Schema" — <first ~60 chars of body>
  2. [#18 · plan · auth] <first ~60 chars of body>
  3. [#31 · doc · auth]  "Backend Flow" — <first ~60 chars of body>
```

Use `AskUserQuestion` if interactive selection is needed.

**If no results:** tell the user nothing was found and suggest running `/knowledge-base-search` with a broader query.

### 4. Fetch and display the full document

Call:
```
get_content(id=<id>)
```

Display the result in a clear format:

```
📄 #<id> · <type> · <workspace>/<feature>
Title: <title>  (omit this line if title is null)

<full body>

---
Created : <created_at>
Updated : <updated_at>
```

Render the body as markdown — do not escape or truncate it.

## Example invocations

- "lấy spec của feature auth" → list_contents(feature="auth", type="spec") → 1 result → get and display
- "xem plan search" → list_contents(feature="search", type="plan") → pick if multiple
- "đọc lại cái idea về caching" → search_content(query="caching idea") → resolve → get
- "get content ID 42" → get_content(id=42) directly
- `/knowledge-base-get` after `/knowledge-base-search` showed results → ask which ID to open
