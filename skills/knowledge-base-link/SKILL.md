---
name: knowledge-base:link
description: Manually create a link (parent → child relationship) between two existing knowledge base documents. Use when the user says "link doc A to doc B", "link #12 to #7", or "connect these two docs".
---

# knowledge-base:link

Create a directed relationship between two existing knowledge base documents.

## How to use this skill

### 1. Identify the two documents

From the user's message, extract the two doc IDs to link. Common forms:
- "link #12 to #7"
- "link doc 12 to 15"
- "#5 is the parent of #9"

If IDs are not given, ask: "What are the IDs of the two docs to link? (use `/knowledge-base-list` to find them)"

### 2. Determine direction

The relationship is directional: **parent → child**.

Natural order: `idea → spec → plan` (parent comes earlier in the chain).

If the user specifies direction explicitly ("A is the parent of B"), use it directly.

If ambiguous, fetch both docs with `get_content` and infer:
- Earlier type in `idea → spec → plan` chain = parent
- If same type or custom types, ask: "Which doc is the parent?"

### 3. Create the link

Call:
```
link_content(parent_id=PARENT_ID, child_id=CHILD_ID)
```

If the response includes `direction_warning`, show it to the user:
```
⚠️  direction_warning: Expected idea→spec→plan but got plan→idea
   Reverse the link direction?
```

**If linking multiple pairs at once, call all `link_content` in parallel in one response.**

### 4. Report

```
✓ Link created
  #<parent_id> → #<child_id>
  Created at: <created_at>
```

If the link already existed (idempotent), report the same — no error.

## Example invocations

- "link #7 to #12, #7 is the parent" → `link_content(parent_id=7, child_id=12)`
- "link doc 3 to doc 8" → infer direction from types, confirm if ambiguous
- "connect all docs in the auth feature into a chain" → fetch all auth docs, suggest idea→spec→plan order, confirm, create links in parallel
