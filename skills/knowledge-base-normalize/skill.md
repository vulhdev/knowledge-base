---
name: knowledge-base:normalize
description: Backfill missing titles for knowledge base documents that have no title set. Use when the user wants to normalize or clean up untitled content — e.g. "normalize titles", "cập nhật title cho các doc cũ", "backfill title trong knowledge base", "các doc chưa có title".
---

# knowledge-base:normalize

Scan all documents in the workspace that have no title, generate a short descriptive title for each using AI, and save automatically.

## How to use this skill

### 1. Read the workspace

Read `KNOWLEDGE_BASE_WORKSPACE` from `CLAUDE.md` (it is already in your context). If it is not set, stop and tell the user: "Run `npx @vulhdev/knowledge-base init` first to set up a workspace."

### 2. Fetch all documents

Call:
```
list_contents(workspace=WORKSPACE)
```

From the results, filter only records where `title` is `null` or an empty string. These are the ones that need normalizing.

If zero records have a missing title, stop and tell the user:
```
✓ Tất cả document trong workspace "<WORKSPACE>" đã có title rồi. Không cần normalize.
```

### 3. Report what was found

Before processing, tell the user:
```
Tìm thấy <N> document chưa có title trong workspace "<WORKSPACE>". Đang sinh title...
```

### 4. Generate titles

For each untitled document, generate a short title by reading its `body`:

**Title rules:**
- ≤ 10 words
- Descriptive and specific — capture the main subject, not generic labels like "Note" or "Document"
- Use the same language as the body (Vietnamese body → Vietnamese title, English body → English title)
- Prefer noun phrases over sentences (e.g. "OAuth2 Token Refresh Flow", "Kế hoạch triển khai auth")
- Do not include the type (idea/spec/plan/doc) in the title — that's already stored separately
- If the body starts with a markdown heading (`# ...`), use that heading text as the title (trimmed, without `#`)

Process all documents in a single pass — do not call `update_content` yet. Hold all (id, generated_title) pairs in context.

### 5. Save all titles

For each (id, generated_title) pair, call:
```
update_content(id=<id>, body=<original body>, title=<generated_title>)
```

Run these sequentially to avoid write conflicts on the database.

### 6. Report results

After all updates are done, print a summary table:

```
✓ Đã normalize <N> document trong workspace "<WORKSPACE>"

| ID | Feature | Type  | Title được sinh                        |
|----|---------|-------|----------------------------------------|
| 12 | auth    | idea  | OAuth2 login brainstorm                |
| 18 | search  | plan  | Kế hoạch triển khai full-text search  |
| 31 | api     | spec  | REST API contract cho endpoint /users  |
```

End with:
```
→ Dùng /knowledge-base-update <id> để chỉnh sửa title nếu cần.
```

## Example invocations

- "normalize titles" → fetch all, filter null, generate, save
- "cập nhật title cho các doc cũ" → same flow
- "backfill title trong knowledge base" → same flow
- `/knowledge-base-normalize` → same flow
