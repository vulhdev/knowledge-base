---
name: knowledge-base:update
description: Update an existing document in the knowledge base by merging the current conversation content with the stored version. Use when the user wants to revise, update, or overwrite a previously saved document — e.g. "cập nhật spec auth", "update plan này vào KB", "sửa lại idea về X", "lưu lại version mới của spec này".
---

# knowledge-base:update

Update an existing knowledge-base document using smart merge — synthesize the old stored body with new content from the current conversation.

## How to use this skill

### 1. Read the workspace

Read `KNOWLEDGE_BASE_WORKSPACE` from `CLAUDE.md` (it is already in your context). If it is not set, stop and tell the user: "Run `npx @vulhdev/knowledge-base init` first to set up a workspace."

### 2. Identify the target document

Use the same lookup logic as `knowledge-base-get`:

**Case A — user provides a numeric ID directly:**
→ Skip to Step 3.

**Case B — user provides feature and/or type:**
→ Call `list_contents(workspace=WORKSPACE, feature=<feature>, type=<type>)`.

**Case C — user describes topic without explicit feature/type:**
→ Call `search_content(query=<keywords>, workspace=WORKSPACE, limit=10)`.

If multiple results, present the list and ask the user to pick (same format as `knowledge-base-get` Step 3).

If no results, stop and tell the user: "Không tìm thấy document nào khớp. Bạn có muốn tạo mới không? Dùng `/knowledge-base-create`."

### 3. Read the existing document

Call:
```
get_content(id=<id>)
```

Hold the full old `body` in context. Note the current `type`.

### 4. Identify the new content

Determine what new content should be merged in:

- If the user invoked this skill right after generating a document in the conversation → use that generated content as the new source.
- If the user pasted or described changes explicitly in their message → use that.
- If it is unclear what the new content is, ask: "Bạn muốn cập nhật với nội dung nào? Nội dung vừa tạo trong conversation, hay bạn muốn nhập trực tiếp?"

### 5. Smart merge

Synthesize the old body and the new content into a single updated document:

**Merge rules:**
- Prioritize new information where it conflicts with old.
- Preserve valuable context from the old body that is not covered in the new content.
- Do not mechanically concatenate — rewrite as a coherent, unified document.
- Keep the same structure and format as the original unless the new content dictates otherwise.
- Do not add commentary like "Updated on..." or "Changes include..." — the body is the document, not a changelog.

### 6. Optionally update the type and title

If the user explicitly mentions a new type (`spec`, `plan`, `idea`, `digest`, `doc`), use it. Otherwise, keep the existing type.

If the user mentions a new title or the content's subject has changed significantly, propose an updated title. Otherwise, omit `title` from the call to preserve the existing value.

### 7. Confirm before writing

Show the merged result to the user and ask for confirmation:

```
Merged result (type: <type>, title: <title or unchanged>):

<merged body preview — full content>

---
Cập nhật document #<id> (<workspace>/<feature>) không?
```

Use `AskUserQuestion` with options: **Xác nhận cập nhật** / **Huỷ**.

If the user cancels, stop without writing.

### 8. Write the update

Call:
```
update_content(id=<id>, body=<merged body>, type=<type if changed>, title=<title if changed>)
```

Omit `type` or `title` from the call when keeping the existing value — passing them preserves the existing value only for `type`; omitting `title` also preserves it.

### 9. Report

```
✓ Đã cập nhật document #<id>
  Workspace : <WORKSPACE>
  Feature   : <feature>
  Type      : <type>
  Title     : <title or (unchanged)>
  Updated   : <updated_at>
```

## Example invocations

- "cập nhật spec auth với spec vừa tạo" → list_contents(feature="auth", type="spec") → get old → merge with latest spec from conversation → confirm → update
- "update plan này vào KB" → search for the most recent plan feature → get old → merge → confirm
- "sửa lại idea #31 — thêm phần về caching" → get_content(31) directly → merge with user's additions → confirm → update
- `/knowledge-base-update spec auth` → type and feature explicit, skip lookup
