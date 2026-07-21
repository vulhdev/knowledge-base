---
name: knowledge-base:review
description: Process committed inline review comments for a knowledge-base document. Use when the user says they finished reviewing, or after a wait_for_review timeout. Fetches comments, classifies intent, and responds appropriately (auto-fix, ask for clarification, or expand content).
---

# knowledge-base:review

Process the committed inline review comments for a knowledge-base document and respond intelligently.

## When to use

- The user says "I finished the review", "review is done", "process the review", or similar
- A `wait_for_review` call timed out and Claude printed instructions to call this skill
- The user explicitly invokes `/knowledge-base-review`

## Steps

### 1. Determine content_id

**If content_id is available in conversation context** (e.g. from a previous `open_for_review` call or timeout message) — use it directly. Skip to Step 2.

**If content_id is not known:**
1. Call `list_contents_with_pending_review()` — returns documents with at least one committed review
2. If empty → tell the user: "No committed reviews found. Open a review session first by saving a document via `/knowledge-base-create`."
3. If one result → use it directly
4. If multiple results → present the list and ask the user which document to process:

```
Which document's review should I process?
  ● #42 · content-review/spec "PR-Style Inline Commenting"
  ○ #17 · auth/plan "Auth Implementation Plan"
```

Use `AskUserQuestion` with one option per document.

### 2. Fetch the committed review

Call `get_pending_review(content_id)`.

If it throws ("No committed review found") → tell the user: "No committed review found for that document. Make sure you clicked 'Commit Review' in the GUI."

### 3. Classify each comment

For each comment in `result.comments`, classify the intent:

| Intent | Signals | Action |
|--------|---------|--------|
| `edit_request` | "change", "replace", "fix", "reword", "rename", "should be", "instead of" | Apply the edit directly to content body |
| `clarification` | "what does", "unclear", "confusing", "don't understand", "explain", "why" | Ask the user to elaborate, then optionally update |
| `expand` | "more detail", "add", "missing", "elaborate", "too brief" | Expand that section inline |
| `positive` | "good", "correct", "keep", "looks good", thumbs up | Acknowledge, no action needed |
| `general` | anything else | Summarize and ask the user what to do |

### 4. Process comments

**For `edit_request` and `expand` comments:**
- Locate the `selected_text` (or the section it refers to) in the document body
- Propose the change inline. If multiple edits exist, group them and apply all at once via `update_content(id, new_body)`
- Tell the user what was changed

**For `clarification` comments:**
- Present the question(s) to the user
- Wait for answers before updating

**For `positive` comments:**
- Briefly acknowledge ("Noted — keeping that section as-is")

**For `general` comments:**
- Summarize and ask: "How would you like me to handle this?"

### 5. Summary report

After processing all comments:

```
✓ Review processed for #<id> · <feature>/<type> "<title>"
  Comments: <N> total
  ✏ Edited: <list of sections changed>
  ❓ Clarifications needed: <list, if any>
  ✓ Kept as-is: <count of positive comments>
```

If the content was updated, remind the user the doc has been saved in the knowledge base.
