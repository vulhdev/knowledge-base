---
name: knowledge-base:explore
description: >
  Proactively load knowledge-base context before starting work on a named feature, bug, or upgrade.
  Use this skill when ALL of the following are true:
  (1) the user names a specific feature, bug area, or upgrade target;
  (2) you do not already have knowledge-base context for that topic in this conversation;
  (3) the task requires understanding prior decisions, specs, or plans — not just reading code.
  Do NOT use if context was already loaded this session, the question is conceptual with no feature named,
  or the user is asking a quick follow-up in an ongoing conversation.
---

# knowledge-base:explore

Load prior knowledge for a feature before starting work — with intent-aware output for debugging and upgrades.

## When to invoke

Invoke this skill **proactively** (without the user asking) when you are about to work on a named feature and have not yet loaded its knowledge-base context this session.

**Invoke when:**
- User says "implement X", "design X", "review X", "debug X", "fix X", "upgrade X", "improve X", or similar action + feature/area name
- Starting a new task that touches a specific feature

**Do NOT invoke when:**
- You already explored this feature earlier in the same conversation
- The user asks a quick conceptual question with no specific feature named
- Context is already present in the conversation (e.g. user pasted a spec inline)
- The feature has no meaningful name (e.g. "this function", "the bug")

---

## Step 0: Read workspace and detect intent

Read `KNOWLEDGE_BASE_WORKSPACE` from `CLAUDE.md`. If not set, skip this skill silently — do not interrupt the user.

Extract from the user's message:
1. **Feature/area name** — the main topic (e.g. "payment", "auth", "webhook")
2. **Intent** — determined by the verb used:
   - **bug mode**: debug, fix, investigate, trace, diagnose, reproduce
   - **upgrade mode**: upgrade, improve, extend, refactor, enhance, migrate
   - **feature mode** (default): implement, design, review, add, build

3. **Symptom** (bug mode only) — the specific problem description beyond the feature name.
   Example: "debug payment webhook not firing on order complete" → feature=`payment`, symptom=`webhook not firing order complete`

---

## Step 1: Quick scan via digest (always run first)

Call `search_semantic` scoped to digests only:

```
search_semantic(query=<feature>, workspace=WORKSPACE, type="digest", limit=3)
```

**If digest results are found:**
- Read each digest's `body` — it contains a TL;DR paragraph and an index table
- Present a compact summary using the **intent-appropriate format** (see Output format below)
- In **quick mode** (default), stop here.

**If no digest results are found** → proceed to Step 2.

---

## Step 2: Fallback — search by raw user input

Search using the full original user message (not the extracted feature name):

```
search_semantic(query=<raw user input>, workspace=WORKSPACE, limit=5)
```

**If results are found:**
- Present them in the intent-appropriate format (see Output format below)
- If `has_more` is true, tell the user: *"X more results available — want to dig deeper?"* and wait for confirmation before calling Step 3.
- If user confirms, proceed to Step 3 with `offset=5`.
- Otherwise stop here.

**If no results found** → proceed to Step 3.

---

## Step 3: Fallback — full-text search by feature name

**For bug mode**, run two searches in parallel:

```
search_semantic(query=<feature>, workspace=WORKSPACE, limit=10)
search_semantic(query=<symptom>, workspace=WORKSPACE, limit=5)   ← secondary symptom search
```

Merge all results, deduplicate by ID. Symptom results are shown in a separate group.

After merging, call `get_code_refs` in parallel for every content ID in the result set:

```
get_code_refs(content_id=<id>)   ← one call per result, all in parallel
```

For any content where `refs` is non-empty, surface the linked commits:

```
🔗 Code refs found on [#<id> · <type>] "<title>":
  - <commit_hash> (<task_ref or "no task">) — <file_paths list>
  ...
```

Then ask: *"Found code refs on N doc(s) — want me to read the relevant files at those commits to help trace the root cause?"*

If the user confirms, run `git show <commit_hash>:<file_path>` (scoped to the `start`–`end` line range when available) for each ref and include the output in the bug context.

**For upgrade mode and feature mode**, run one search:

```
search_semantic(query=<feature>, workspace=WORKSPACE, limit=10)
```

Load full bodies of the top results via `get_content` before presenting (any type — idea, spec, plan, doc, etc.).

For each top result (up to 2), call `get_lineage` in parallel to discover linked ancestors and descendants not returned by search:

```
get_lineage(id=<content_id>)
```

Add any newly discovered IDs not already in the result set. Load their bodies if directly relevant to the task (any type).

**If `has_more` is true after any search in this step**, tell the user: *"X more results available — want to dig deeper?"* and wait for confirmation before fetching the next page with `offset` incremented by `limit`.

---

## Step 4: Deep mode (only when explicitly needed)

Enter deep mode when:
- Quick mode returned a digest index but you need the **full body** of a specific spec, plan, or doc
- The user explicitly asks to "read the full spec" or "load the full doc"

Call `get_content` and `get_lineage` in parallel:

```
get_content(id=<id>)
get_lineage(id=<id>)
```

Load only IDs directly relevant to the current task — not all of them. Show lineage as a "Linked docs" section beneath the full body.

---

## Output format

### Bug mode 🐛

```
🐛 Knowledge-base context for bug in `<feature>`:
Symptom: <extracted symptom or "not specified">

**Known issues / open questions:**
- [#23 · spec] "Webhook Reliability" — excerpt mentioning the edge case...

**Related decisions in this area:**
- [#31 · doc] "Payment Flow" — excerpt explaining the design choice...

**Symptom matches (cross-feature):**
- [#44 · plan] "Fix retry logic" — matched on: "webhook not firing"...

**Linked docs (via lineage):**
- [#10 · spec] "Payment Design" ← ancestor of #31
- [#50 · plan] "Fix webhook retry" → child of #31
```

If nothing found in any group, note it:
> "No prior knowledge found for bug in `<feature>`. This may be a new issue."

---

### Upgrade mode 🔧

```
🔧 Knowledge-base context for upgrading `<feature>`:

**Current state (load full body):**
- [#12 · spec] "DB Schema" — <full body>
- [#18 · plan] "Backend Flow" — <full body>

**Past decisions / constraints:**
- [#31 · spec] "Token Expiry Design" — excerpt with the rationale...

**Open questions (never resolved):**
- [#29 · idea] "Refresh token rotation" — excerpt with the question...

**Linked docs (via lineage):**
- [#8 · idea] "Initial DB proposal" ← ancestor of #12
- [#20 · plan] "Schema migration v2" → child of #12
```

---

### Feature mode 📚 (default)

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

**Top results (current state):**
- [#12 · spec] "DB Schema" — <full body loaded>

**Other:**
- [#31 · spec] Short excerpt from body...

**Linked docs (via lineage):**
- [#8 · idea] "Initial DB proposal" ← ancestor of #12
```

If nothing found:
```
📚 No prior knowledge found for `<feature>`. Starting fresh.
```

---

## Decision table

| Situation | Action |
|---|---|
| Bug mode + digest found | Present: known issues group, related decisions, stop (quick) |
| Bug mode + no digest + raw input hit | Search by raw user input; present results; stop |
| Bug mode + no digest + no raw input hit | Parallel search: feature + symptom; merge results; call `get_lineage` on top results |
| Bug mode + nothing found | Note it: may be a new/undocumented issue |
| Upgrade mode + digest found | Present: current state docs, past decisions, open questions |
| Upgrade mode + no digest + raw input hit | Search by raw user input; present results; stop |
| Upgrade mode + no digest + no raw input hit | Load full bodies (any type) + `get_lineage`; present decisions, open questions, linked docs |
| Feature mode + digest found | Present TL;DR + index table, stop (quick) |
| Feature mode + no digest + raw input hit | Search by raw user input; present results; stop |
| Feature mode + no digest + no raw input hit | Load full bodies (any type) + `get_lineage`; present raw results and linked docs |
| Nothing found (any mode) | Note it briefly, proceed with task |
| Workspace not configured | Skip silently |
| Already explored this session | Skip — don't call again |

---

## Example scenarios

**"Debug the payment webhook — it's not firing when order completes"**
→ intent=bug, feature=`payment`, symptom=`webhook not firing order complete`
→ parallel search: `search_semantic(query="payment")` + `search_semantic(query="webhook not firing order complete")`
→ group results: known issues → related decisions → symptom matches
→ present bug mode output

**"Upgrade the auth refresh token flow"**
→ intent=upgrade, feature=`auth`
→ `search_semantic(query="auth", type="digest")` → no digest → `search_semantic(query="auth", limit=10)`
→ load full body of top results (any type)
→ group: current state → past decisions → open questions → present upgrade mode output

**"Implement tính năng tạo bài viết"**
→ intent=feature, feature=`bài viết`
→ `search_semantic(query="bài viết", type="digest")` → no digest → `search_semantic(query="bài viết", limit=10)`
→ load full bodies of top results (any type) → present feature mode output

**"Review the search feature"**
→ intent=feature, feature=`search`
→ `search_semantic(query="search", type="digest")` → digest found → present TL;DR + index → done

**"What is dependency injection?"**
→ Conceptual question, no feature named → **do not invoke this skill**
