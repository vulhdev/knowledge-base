---
name: knowledge-base:list
description: Browse all documents in a feature of the knowledge base without needing a search query. Use when the user wants to see what's stored in a feature — e.g. "list documents trong auth", "xem tất cả content của feature search", "knowledge base có gì trong payments", "liệt kê docs của X". Distinct from knowledge-base-search (which requires a keyword) — this fetches everything in a feature as a structured table.
---

# knowledge-base:list

Browse all documents stored in a feature, presented as a structured table for easy scanning.

## How to use this skill

### 1. Read the workspace

Read `KNOWLEDGE_BASE_WORKSPACE` from `CLAUDE.md` (it is already in your context). If it is not set, stop and tell the user: "Run `npx --package @vulhdev/knowledge-base knowledge-base-init` first to set up a workspace."

### 2. Determine the target feature

**Case A — feature name is explicit in the message** (e.g. "list auth", "xem feature search"):
→ Use it directly. Skip to Step 3.

**Case B — no feature name given:**

Do two things in parallel:
- Infer a feature from conversation context (what feature are we currently working on or discussing?)
- Call `list_contents(workspace=WORKSPACE)` to retrieve all documents, then extract the unique feature names.

Present an `AskUserQuestion` with:
- The inferred feature first (if found), labelled "(gợi ý từ context)"
- Up to 3 other feature names from the DB, ordered by most recently updated
- A "Tất cả features" option as fallback

```
Bạn muốn xem feature nào?
  ● auth (gợi ý từ context)
  ○ search
  ○ payments
  ○ Tất cả features
```

If no documents exist in the workspace at all, stop and tell the user: "Workspace `<WORKSPACE>` chưa có document nào. Tạo mới với `/knowledge-base-create`."

### 3. Fetch the documents

**If a specific feature was chosen:**
```
list_contents(workspace=WORKSPACE, feature=FEATURE)
```

**If "Tất cả features" was chosen:**
```
list_contents(workspace=WORKSPACE)
```

### 4. Present results as a table

Format results as a markdown table. For each row:
- **Title column**: show `title` if set; otherwise show the first 80 characters of `body` (truncated with `…`)
- **Excerpt column**: only show when title is present and more context would help; omit if title is already descriptive

```
Feature: auth  (5 documents)

| ID | Type  | Title / Excerpt                                      |
|----|-------|------------------------------------------------------|
| 21 | doc   | DB Schema                                            |
| 22 | doc   | Backend Flow                                         |
| 15 | spec  | OAuth2 token refresh implementation spec — user lo… |
| 18 | plan  | Implementation plan: 6 tasks covering login, OAuth… |
| 12 | idea  | Initial brainstorm: support email, Google, GitHub…  |
```

When "Tất cả features" was used, group rows by feature with a subheader per group:

```
Feature: auth  (3 documents)
| ID | Type | Title / Excerpt |
...

Feature: search  (2 documents)
| ID | Type | Title / Excerpt |
...
```

**If results > 15 rows**, show all but add a note at the bottom:
> Có nhiều documents. Thêm type filter để thu hẹp — ví dụ: "list doc của auth".

**If no documents found for the feature**, tell the user and suggest creating one.

### 5. Suggest follow-up actions

End with a compact one-liner:
```
→ Dùng /knowledge-base-get <id> để đọc full document, hoặc /knowledge-base-update <id> để cập nhật.
```

## Example invocations

- "list auth" → `list_contents(feature="auth")` → table
- "xem tất cả content của feature search" → `list_contents(feature="search")` → table
- "knowledge base có gì?" → no feature → infer from context + list features → ask → fetch
- "liệt kê docs của payments" → `list_contents(feature="payments", type="doc")` (type="doc" inferred from "docs")
- `/knowledge-base-list` with no args → Case B flow
