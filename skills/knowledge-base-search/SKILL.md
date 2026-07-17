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

6. If no results are found, suggest broadening the query or listing all contents with `list_contents`.

## Example invocations

- "search for auth ideas" → query: `auth`, type: `idea`
- "find the deployment plan" → query: `deployment`, type: `plan`
- "what specs do we have for search?" → query: `search`, type: `spec`
- "look up anything about caching" → query: `caching`, no type filter
- "find the doc về DB schema của auth" → query: `auth DB schema`, type: `doc`
