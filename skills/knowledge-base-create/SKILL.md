---
name: knowledge-base-create
description: Save a spec, plan, idea, or doc from the current conversation into the knowledge base database. Use when the user asks to save, store, or persist something just created in this conversation — e.g. "save this spec", "lưu plan này", "store the idea we just discussed", "lưu doc về feature này".
---

# knowledge-base:create

Save a document from the current conversation into the knowledge base.

## How to use this skill

### 1. Read the workspace

Read `KNOWLEDGE_BASE_WORKSPACE` from `CLAUDE.md` (it is already in your context). If it is not set, stop and tell the user: "Run `npx --package @vulhdev/knowledge-base knowledge-base-init` first to set up a workspace."

### 2. Determine type

Check the user's message for an explicit type keyword: `spec`, `plan`, `idea`, or `doc`.

If no keyword is found, infer from the content being saved:
- Checkboxes (`- [ ]`), ordered steps, phased work → `plan`
- Requirements, schema, API contract, "must/should" language → `spec`
- Exploratory, open questions, brainstorming → `idea`
- Current-state documentation of existing code (DB schema, backend flow, frontend structure, how something works right now) → `doc`

If still ambiguous, default to `idea`.

### 3. Extract content from context

Take the most recent substantial document that the AI produced in this conversation — the last large structured block (markdown sections, lists, code blocks). Do NOT re-generate or summarize it. Use it verbatim.

### 4. Determine feature

**Step A — Infer from context:**
Based on the conversation topic (what was being designed, discussed, or built), propose a short feature name (e.g. `auth`, `search`, `onboarding`).

**Step B — Cross-check with DB:**
Call `list_contents(workspace=WORKSPACE)` to retrieve existing entries. Extract the unique feature names from the results.

**Step C — Ask the user:**
Present an `AskUserQuestion` with:
- Up to 3 existing features that are most relevant to the inferred topic (prefer exact or partial match)
- A "Tạo feature mới" option

If the inferred feature exactly matches an existing one, put it first.

Example:
```
Lưu vào feature nào?
  ● auth (đang có)
  ○ api
  ○ search
  ○ Tạo feature mới
```

If the user picks "Tạo feature mới", ask: "Tên feature mới là gì?"

### 5. Determine title (optional)

A `title` is a short label (≤ 80 chars) that makes the document easy to identify in list/search results without reading the body.

**Always ask for a title when:**
- `type` is `doc` — multiple docs per feature are common, title disambiguates them (e.g. "DB Schema", "Backend Flow", "Frontend Structure")

**Suggest a title when:**
- The content has a clear heading or subject

**Skip title when:**
- `type` is `idea` and the first line of body is short enough to serve as a label

If asking, use `AskUserQuestion` with a suggested title pre-filled as the first option.

### 6. Save to database

Call:
```
create_content(workspace=WORKSPACE, feature=FEATURE, type=TYPE, body=CONTENT, title=TITLE)
```

Omit `title` if not set.

### 7. Report

```
✓ Đã lưu vào knowledge base
  Workspace : <WORKSPACE>
  Feature   : <feature>
  Type      : <type>
  Title     : <title or (none)>
  ID        : <id>
```

## Example invocations

- `/knowledge-base-create` after generating a spec → detect type=spec, infer feature, ask to confirm
- "Lưu spec này giúp mình" → type=spec from keyword
- "Save plan vào knowledge base" → type=plan from keyword
- "Lưu doc về DB schema của feature tạo bài viết" → type=doc, ask for title (suggest "DB Schema"), save
- `/knowledge-base-create spec auth` → type and feature explicit, skip to step 5
