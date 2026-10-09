---
name: knowledge-base:search
description: Search the knowledge base for stored ideas, specs, plans, or docs. Use when the user asks to find, recall, look up, or retrieve documents from the knowledge base. Reads KNOWLEDGE_BASE_WORKSPACE from CLAUDE.md to scope the search automatically.
---

# knowledge-base:search

Search the knowledge base for documents stored under the current workspace.

## How to use this skill

1. **Read the workspace** from `KNOWLEDGE_BASE_WORKSPACE` in `CLAUDE.md` (it is already in your context). If it is not set, tell the user to run `npx knowledge-base init` first.

2. **Extract the query** from the user's message — the topic, keyword, or phrase they want to find.

3. **Identify an optional type filter** if the user specifies one:
   - `idea` — raw ideas and explorations
   - `spec` — specifications and requirements
   - `plan` — implementation plans
   - `doc` — current-state documentation (DB schema, backend flow, frontend structure)
   - `digest` — feature summaries
   If no type is mentioned, search across all types.

4. **Call `search_semantic`** with:
   - `query`: the extracted search terms
   - `workspace`: the value of `KNOWLEDGE_BASE_WORKSPACE`
   - `type` (optional): the identified type filter
   - `limit`: 10 (default)

5. **Present the results** clearly. Show title when available, fall back to a body excerpt:

   ```
   #12 · doc · auth — "DB Schema"
   #18 · spec · auth — OAuth2 token refresh implementation...
   #31 · idea · search — full text search plan with FTS5...
   ```

   Always include the document ID for follow-up actions (e.g. `get_content` to read the full body).

   When a result has `matched_sections`, show them under it — they say *where* in the document the match is:

   ```
   #12 · doc · auth — "DB Schema"
       § DB Schema › Tables › sessions  (L120–168)
   #57 · sot-spec · F-002 — "F-002-genka-kentosho.md · F-002 原価検討書 …"
       § … › Use Cases › UC-F002-009 …  (L408–442 @ f8c4702, docs/design/business-design/F-002-genka-kentosho.md)
   ```

   - Each element is `{chunk_key, heading_path, start_line, end_line}`; at most 3, most relevant first.
   - For a document, `chunk_key` is `<id>#<outline>` and the lines are lines of its body (`get_content`, then read those lines).
   - For an SOT card (`source_path` and `source_commit` present) the card body holds no SOT text. Read the section from the repository: `git -C <repo> show <source_commit>:<source_path>` and take lines `start_line`–`end_line` (the card body states the repository path in its `read:` line).
   - Japanese/Chinese terms are matched even in the middle of a sentence, so a short term such as `掛率` is a good query.

6. If no results are found, suggest broadening the query or listing all contents with `list_contents`.

## Example invocations

- "search for auth ideas" → query: `auth`, type: `idea`
- "find the deployment plan" → query: `deployment`, type: `plan`
- "what specs do we have for search?" → query: `search`, type: `spec`
- "look up anything about caching" → query: `caching`, no type filter
- "find the doc về DB schema của auth" → query: `auth DB schema`, type: `doc`
