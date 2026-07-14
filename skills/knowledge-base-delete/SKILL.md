---
name: knowledge-base-delete
description: Permanently delete a document from the knowledge base. Use when the user wants to remove a stored document — e.g. "xóa spec auth", "delete idea #31", "bỏ plan cũ của feature search", "xóa cái content về X". Always shows the document and asks for confirmation before deleting.
---

# knowledge-base:delete

Permanently delete a document from the knowledge base.

## How to use this skill

### 1. Read the workspace

Read `KNOWLEDGE_BASE_WORKSPACE` from `CLAUDE.md` (it is already in your context). If it is not set, stop and tell the user: "Run `npx --package @vulhdev/knowledge-base knowledge-base-init` first to set up a workspace."

### 2. Identify the target document

**Case A — user provides a numeric ID directly** (e.g. "xóa ID 42", "delete content #7"):
→ Skip to Step 3. Call `get_content(id=<id>)` immediately.

**Case B — user provides feature and/or type** (e.g. "xóa spec của auth", "delete plan search"):
→ Call `list_contents(workspace=WORKSPACE, feature=<feature>, type=<type>)` with the known filters.

**Case C — user describes topic without explicit feature/type** (e.g. "xóa cái document về deployment"):
→ Extract keywords and call `search_content(query=<keywords>, workspace=WORKSPACE, limit=10)`.

### 3. Resolve to a single document (if needed)

**If exactly 1 result:** proceed directly to Step 4.

**If multiple results:** present a concise list and ask the user to pick. Show title when available:

```
Tìm thấy nhiều documents — bạn muốn xóa cái nào?

  1. [#12 · spec · auth] <first ~60 chars of body>
  2. [#18 · doc · auth]  "DB Schema" — <first ~60 chars of body>
  3. [#31 · doc · auth]  "Backend Flow" — <first ~60 chars of body>
```

Use `AskUserQuestion` if interactive selection is needed.

**If no results:** tell the user nothing was found and suggest `/knowledge-base-search` with a broader query.

### 4. Display the document and confirm

Fetch the full document if not already retrieved:
```
get_content(id=<id>)
```

Show it clearly:

```
📄 #<id> · <type> · <workspace>/<feature>
Title: <title>  (omit this line if title is null)

<full body>

---
Created : <created_at>
Updated : <updated_at>
```

Then ask for confirmation using `AskUserQuestion`:

```
Xóa vĩnh viễn document #<id> (<workspace>/<feature> · <type>) không?
Hành động này không thể hoàn tác.
```

Options: **Xác nhận xóa** / **Huỷ**

If the user cancels, stop without deleting.

### 5. Delete

Call:
```
delete_content(id=<id>)
```

### 6. Report

```
✓ Đã xóa document #<id>
  Workspace : <workspace>
  Feature   : <feature>
  Type      : <type>
```

## Example invocations

- "xóa spec auth" → list_contents(feature="auth", type="spec") → 1 result → display → confirm → delete
- "delete idea #31" → get_content(31) directly → display → confirm → delete
- "bỏ cái plan cũ về caching" → search_content(query="caching plan") → resolve → display → confirm → delete
- "xóa hết plan trong feature search" → list_contents(feature="search", type="plan") → if multiple, ask which one(s) → confirm each → delete
