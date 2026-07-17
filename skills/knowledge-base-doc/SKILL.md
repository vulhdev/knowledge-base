---
name: knowledge-base:doc
description: >
  Analyze a codebase feature in depth and save the result as structured doc(s) in the knowledge base.
  Use when the user wants to document how an existing feature works — e.g. "document the auth feature",
  "phân tích tính năng tạo bài viết", "tạo doc cho payments", "ghi lại cách hoạt động của search".
  Checks for existing docs first and can use them as a discovery map for re-analysis.
---

# knowledge-base:doc

Analyze a feature in the codebase and produce structured `doc` content (DB Schema, Backend Flow, Frontend) saved to the knowledge base.

---

## How to use this skill

### Step 1: Read the workspace

Read `KNOWLEDGE_BASE_WORKSPACE` from `CLAUDE.md`. If not set, stop and tell the user to run `npx @vulhdev/knowledge-base init` first.

---

### Step 2: Identify the feature

Extract the feature name from the user's message. Derive two search terms in parallel:

- **Vietnamese term**: the feature name as stated (e.g. "tạo bài viết", "thanh toán")
- **English slug**: a short English identifier (e.g. "post", "payment") — infer it from context or common patterns. If you cannot confidently infer it, ask the user: "Trong codebase, feature này thường được gọi là gì? (e.g. `post`, `article`)"

---

### Step 3: KB lookup — check for existing docs

```
search_semantic(workspace=WORKSPACE, type="doc", query=<feature_name>, limit=10)
```

**If docs are found**, present them:

```
📄 Tìm thấy doc liên quan đến "<feature>":

  #21 · doc · auth — "DB Schema"
  #22 · doc · auth — "Backend Flow"
  #23 · doc · auth — "Frontend"
```

Then ask with `AskUserQuestion`:

```
Bạn muốn làm gì với các doc này?
  ○ Xem doc cũ trước khi quyết định
  ○ Dùng doc cũ làm context, phân tích lại (warm start)
  ○ Bỏ qua, phân tích hoàn toàn mới (cold start)
```

- **"Xem doc cũ"** → call `get_content` on each, display full body, then ask again (same 3 options minus "xem").
- **"Dùng doc cũ làm context"** → load all found docs. Extract file paths, module names, and patterns mentioned in them. Use these as **priority hints** in Step 4. Set `existingDocs = [list of {id, title}]`.
- **"Bỏ qua, phân tích mới"** → proceed with cold start. Set `existingDocs = []`.

**If no docs found**, proceed with cold start and note it briefly.

---

### Step 4: Discover relevant files

Run discovery in layers. Each layer feeds the next.

**Layer 1 — Grep both terms:**

Search across the whole codebase:
```bash
grep -rl "<vietnamese_term>" . --include="*.ts" --include="*.tsx" --include="*.js" --include="*.py" --include="*.go" 2>/dev/null | head -30
grep -rl "<english_slug>" . --include="*.ts" --include="*.tsx" --include="*.js" --include="*.py" --include="*.go" 2>/dev/null | head -30
```

**Layer 2 — Directory patterns:**

Look for common feature directory structures:
```bash
find . -type d -name "*<english_slug>*" | grep -v node_modules | grep -v dist
find . -type f -name "*<english_slug>*" | grep -v node_modules | grep -v dist | head -20
```

**Layer 3 — Old doc hints (warm start only):**

If `existingDocs` is non-empty, scan their bodies for file paths and module references:
- Lines matching `src/...`, file extensions (`.ts`, `.tsx`, `.go`, etc.)
- Table names, model names, route patterns
- Add these to the read queue with **higher priority** than grep results

**Consolidate and confirm:**

Show the discovered file list and ask the user to confirm before deep-reading:

```
📂 Sẽ phân tích các files sau:

  DB:       prisma/migrations/..., src/models/post.ts
  Backend:  src/routes/post.ts, src/services/post.service.ts
  Frontend: src/pages/PostCreate.tsx, src/hooks/usePost.ts

Tiếp tục phân tích? (có thể thêm/bỏ files nếu muốn)
```

Use `AskUserQuestion` with options: **Tiếp tục** / **Tôi muốn điều chỉnh danh sách**.

If the user wants to adjust, ask them to specify which files to add or remove, then proceed.

---

### Step 5: Analyze — fill the template

Read each confirmed file. Produce analysis in three sections. **Skip any section where no evidence was found** — do not write empty sections.

#### DB Schema
Scan for: migration files, ORM model definitions, schema files, table definitions, `CREATE TABLE` SQL.

Write:
- Tables involved and their purpose
- Key columns with types and constraints
- Relationships (foreign keys, associations)
- Indexes relevant to the feature

#### Backend Flow
Scan for: route definitions, controllers/handlers, service layer, repository/data-access layer, middleware specific to the feature.

Write:
- API endpoints (method, path, auth requirement)
- Request → middleware → handler → service → DB flow
- Key business rules enforced in service layer
- Error handling patterns

#### Frontend
Scan for: pages, components, hooks, stores, API client calls related to the feature.

Write:
- Entry point (page/route)
- Key components and their responsibilities
- State management (hooks, stores, context)
- API calls made and what they map to

**If a section has no evidence**, note it at the end:
```
⚠ Không tìm thấy [Frontend] code liên quan đến feature này.
```

---

### Step 6: Present analysis and ask how to save

Display the full analysis result (all sections found).

Then handle the save decision:

#### 6a — Format choice (ask with AskUserQuestion):
```
Bạn muốn lưu như thế nào?
  ○ Nhiều doc riêng biệt theo section (có title: "DB Schema", "Backend Flow", "Frontend") — dễ update từng phần
  ○ Một doc tổng hợp duy nhất
```

#### 6b — Create or overwrite (ask with AskUserQuestion):

**If `existingDocs` is non-empty:**
```
Đã có doc cũ. Bạn muốn:
  ○ Tạo doc mới (giữ nguyên doc cũ, tạo thêm)
  ○ Overwrite doc cũ (cập nhật trực tiếp)
```

If **overwrite** and the new analysis produced **fewer sections** than existing docs, surface the gap explicitly before writing:

```
⚠ Phân tích mới không tìm thấy nội dung cho:
  - "Frontend" (doc #23) — không phát hiện frontend code liên quan

Lý do có thể: feature này là backend-only, hoặc frontend nằm ở repo khác.

Bạn muốn làm gì với doc #23?
  ○ Giữ nguyên (không thay đổi)
  ○ Xóa doc này
  ○ Xem lại trước khi quyết định
```

Handle each orphaned doc separately before writing the main results.

---

### Step 7: Save

Based on user choices:

**Separate docs per section:**
```
create_content(workspace=WORKSPACE, feature=FEATURE, type="doc", title="DB Schema", body=<db_section>)
create_content(workspace=WORKSPACE, feature=FEATURE, type="doc", title="Backend Flow", body=<backend_section>)
create_content(workspace=WORKSPACE, feature=FEATURE, type="doc", title="Frontend", body=<frontend_section>)
```

Or for overwrite:
```
update_content(id=<existing_id>, body=<new_body>, title=<title>)
```

**Single combined doc:**
```
create_content(workspace=WORKSPACE, feature=FEATURE, type="doc", title="<Feature> — Full Doc", body=<combined>)
```

---

### Step 8: Report

```
✓ Doc đã được lưu cho feature "<feature>"

  #31 · doc · <feature> — "DB Schema"
  #32 · doc · <feature> — "Backend Flow"
  #33 · doc · <feature> — "Frontend"

→ Dùng /explore để load context này trong các task tiếp theo.
```

---

## Example invocations

- "document the auth feature" → feature=auth, english_slug=auth, grep both, analyze, save
- "phân tích tính năng tạo bài viết" → Vietnamese="tạo bài viết", ask/infer slug="post", discover, analyze
- "tạo doc cho payments" → feature=payments, slug=payment, check KB first
- `/knowledge-base:doc search` → feature=search, slug=search, check KB, cold or warm start
- "doc lại auth đi, có thể outdated rồi" → feature=auth, KB finds old docs, user picks "warm start", re-analyze using old file hints
