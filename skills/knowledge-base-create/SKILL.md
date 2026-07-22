---
name: knowledge-base:create
description: Save a spec, plan, idea, or doc from the current conversation into the knowledge base database. Use when the user asks to save, store, or persist something just created in this conversation — e.g. "save this spec", "store this plan", "save the idea we just discussed", "save the doc for this feature".
---

# knowledge-base:create

Save a document from the current conversation into the knowledge base.

## How to use this skill

### 1. Read the workspace

Read `KNOWLEDGE_BASE_WORKSPACE` from `CLAUDE.md` (it is already in your context). If it is not set, stop and tell the user: "Run `npx @vulhdev/knowledge-base init` first to set up a workspace."

### 2. Determine type

Check the user's message for an explicit type keyword: `spec`, `plan`, `idea`, `doc`, or any
custom string they mention (e.g. "save this as an issue", "type: adr").

If no keyword is found, infer from the content being saved:
- Checkboxes (`- [ ]`), ordered steps, phased work → `plan`
- Requirements, schema, API contract, "must/should" language → `spec`
- Exploratory, open questions, brainstorming → `idea`
- Current-state documentation of existing code (DB schema, backend flow, frontend structure, how something works right now) → `doc`

If still ambiguous, defer to Step 4: after fetching `list_contents` to build the feature
suggestion list, extract the unique `type` values already in use in that workspace. Then ask
the user with an `AskUserQuestion` that shows both the built-in suggestions and any existing
custom types from the DB. Default to `idea` if the user skips.

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
- A "Create new feature" option

If the inferred feature exactly matches an existing one, put it first.

Example:
```
Which feature to save under?
  ● auth (existing)
  ○ api
  ○ search
  ○ Create new feature
```

If the user picks "Create new feature", ask: "What should the new feature be called?"

### 5. Determine title (optional)

A `title` is a short label (≤ 80 chars) that makes the document easy to identify in list/search results without reading the body.

**Always ask for a title when:**
- `type` is `doc` — multiple docs per feature are common, title disambiguates them (e.g. "DB Schema", "Backend Flow", "Frontend Structure")

**Suggest a title when:**
- The content has a clear heading or subject

**Skip title when:**
- `type` is `idea` and the first line of body is short enough to serve as a label

If asking, use `AskUserQuestion` with a suggested title pre-filled as the first option.

### 5b. Check session context for a parent (optional)

Scan the current conversation history for any docs saved earlier in this session — look for `✓ Saved to knowledge base` report blocks that include an `ID`.

**Only apply when the type chain is valid:**

| Type being saved | Look for parent of type |
|---|---|
| `spec` | `idea` |
| `plan` | `spec` (preferred) or `idea` |
| `idea`, `doc`, others | — skip this step |

If a candidate parent is found, ask:

```
This session you already saved [idea #42 "Payment Redesign"].
Link this spec to it as a child?
  ● Yes — use as parent
  ○ No — save standalone
```

Use `AskUserQuestion` with those two options.

- **If yes** → proceed to Step 6 with `PARENT_ID` set; use `derive_content` instead of `create_content`.
- **If no, or no candidate found** → proceed to Step 6 without a parent; use `create_content`.

### 6. Save to database

**If `PARENT_ID` is set** (from Step 5b):

```
derive_content(parent_id=PARENT_ID, type=TYPE, body=CONTENT, title=TITLE)
```

`derive_content` inherits workspace and feature from the parent and creates the link automatically — skip `link_content` for this parent.

**Otherwise:**

```
create_content(workspace=WORKSPACE, feature=FEATURE, type=TYPE, body=CONTENT, title=TITLE)
```

Omit `title` if not set in either case.

### 6b. Handle conflicts (if any)

Check `result.conflicts[]` from the `create_content` response.

**If `conflicts[]` is empty** → skip to Step 7.

**If conflicts exist**, separate into two groups:

**`semantic_contradiction` (high severity):**

1. Call `get_content(id=conflict.content_id)` in parallel for each contradiction to retrieve the body.
2. Display a warning block for each, showing the first 150 chars of body as excerpt:

```
⚠ Conflict detected — the saved doc may contradict:

  #35 · conflict-detection/spec "Spec: Cross-content..."
  Reason: "New doc defines ConflictResult differently from the existing definition"
  Excerpt: "When the user saves a new document via create_content..."
```

3. **Optional deep analysis** — ask the user:

```
Run deep conflict analysis?
  ● Yes — spawn kb-conflict-resolver agent (reads both docs in full, explains contradiction, recommends action)
  ○ No — proceed with lightweight flow
```

If yes, spawn `kb-conflict-resolver` via the Agent tool:
- Pass: new doc body, conflicting doc body, and `conflict.reason`
- The agent returns a reconciliation memo (nature of conflict, exact quotes, recommended action)
- Present the memo to the user before proceeding to the link step

4. Use `AskUserQuestion` (multiSelect: true) to ask which conflicting docs to link:
   - One option per conflicting doc: `#<id> · <feature>/<type> "<title>"`
   - Plus: `"Do not link any"`

5. For each confirmed link, call `link_content` — all in parallel. Direction: conflicting doc is typically the parent (older); new doc is the child.

**`risk_shadow` (low severity):**

Do not interrupt. Collect all `risk_shadow` conflicts and surface them in Step 8 report as a note section. No action required.

### 7. Suggest links (optional)

After saving, check if there are related documents to link.

**Skip this step if** `list_contents` from Step 4 returned fewer than 3 docs total.

Otherwise call:
```
search_semantic(query="<title> <body_first_300_chars>", workspace=WORKSPACE, limit=3)
```

If results are returned, present them:
```
Related docs — link any of these?
  [ ] #12 auth/spec "OAuth2 Token Refresh Flow"
  [ ] #7  auth/idea "Auth Strategy"
```

For each confirmed doc, call `link_content` with the correct direction:
- `idea → spec → plan`: parent is the earlier type in the chain
- When direction is ambiguous, ask: "Which doc is the parent?"

**If linking multiple docs, call all `link_content` in parallel in one response** — do not await each call sequentially.

### 8. Report

```
✓ Saved to knowledge base
  Workspace : <WORKSPACE>
  Feature   : <feature>
  Type      : <type>
  Title     : <title or (none)>
  ID        : <id>
  Links     : #12 (parent), #7 (parent)   ← if any

⚡ Risk shadowed:
  #30 · conflict-detection/plan — "New doc does not address the retry logic risk flagged here"
  ← only show if risk_shadow conflicts exist; omit this section otherwise
```

### 9. Offer inline review (optional)

After printing the Step 8 report, ask the user:

> "Want to review this document in the GUI before moving on?"

**If yes:**
1. Call `open_for_review(content_id)` with the ID from Step 8
2. Print the returned URL clearly:
   ```
   Review URL: http://localhost:3000/ws/.../review?review_id=<N>
   Note: Start GUI server first if not running: npx @vulhdev/knowledge-base gui
   ```
3. Call `wait_for_review(content_id)` (default timeout 300s)
4. **If review commits within timeout:** receive the comments and process them following the same logic as `/knowledge-base-review` (Step 3–5 of that skill)
5. **If timeout:** print:
   ```
   Review not committed within the wait window.
   When you're done reviewing, call /knowledge-base-resolve-feedback to process the feedback.
   ```

**If no (or user skips):** done.

## Example invocations

- `/knowledge-base-create` after generating a spec → detect type=spec, infer feature, ask to confirm
- "Save this spec" → type=spec from keyword
- "Save this plan to the knowledge base" → type=plan from keyword
- "Save the DB schema doc for the posts feature" → type=doc, ask for title (suggest "DB Schema"), save
- `/knowledge-base-create spec auth` → type and feature explicit, skip to step 5
- Session already saved idea #42, now saving a spec → Step 5b detects the idea, asks to link → use `derive_content(parent_id=42, ...)`
