---
name: knowledge-base:review
description: Proactively open a knowledge-base document for inline review in the GUI. Use when the user wants to review an existing document — picks a doc, opens a review session, waits for feedback, then hands off to knowledge-base:resolve-feedback to process comments.
---

# knowledge-base:review

Open an existing knowledge-base document for inline review in the GUI. The user annotates it with comments, commits the review, and Claude processes the feedback.

## When to use

- The user says "I want to review [doc]", "open this for review", "let me annotate this", or similar
- The user explicitly invokes `/knowledge-base-review`

## Steps

### 1. Determine which document to review

**If content_id is already in context** (e.g. user references a specific doc ID or title) — confirm and skip to Step 2.

**If not specified:**
1. Call `list_contents(workspace=WORKSPACE)` to browse available documents
2. Ask the user which document to open:

```
Which document do you want to review?
  ● #67 · content-review/plan "PR-Style Inline Commenting Plan"
  ○ #66 · content-review/spec "PR-Style Inline Commenting"
  ○ #44 · semantic-search/spec "Spec: Semantic Search"
```

Use `AskUserQuestion` with the most recently updated docs as options (up to 4).

### 2. Open a review session

Call `open_for_review(content_id)`.

Print the returned URL clearly:
```
Review URL: http://localhost:3000/ws/.../review?review_id=<N>
Note: Start the GUI server first if not running: npx @vulhdev/knowledge-base gui
```

### 3. Wait for the review to be committed

Call `wait_for_review(content_id)` (default timeout 300s).

**If review commits within timeout:** receive the comments and hand off to Step 4.

**If timeout:** print:
```
Review not committed within the wait window.
When you're done reviewing, call /knowledge-base-resolve-feedback to process the feedback.
```
Then stop.

### 4. Process the committed feedback

Follow the steps in `/knowledge-base-resolve-feedback` (Steps 3–5) to classify and respond to each comment.
