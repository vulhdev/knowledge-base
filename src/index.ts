#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb } from "./db/client.js";
import { createContent } from "./tools/create-content.js";
import { getContent } from "./tools/get-content.js";
import { listContents } from "./tools/list-contents.js";
import { searchSemantic } from "./tools/search-semantic.js";
import { updateContent } from "./tools/update-content.js";
import { deleteContent } from "./tools/delete-content.js";
import { linkContent } from "./tools/link-content.js";
import { deriveContent } from "./tools/derive-content.js";
import { getLineage } from "./tools/get-lineage.js";
import { attachCodeRef } from "./tools/attach-code-ref.js";
import { getCodeRefs } from "./tools/get-code-refs.js";
import { openForReview } from "./tools/open-for-review.js";
import { waitForReview } from "./tools/wait-for-review.js";
import { getPendingReviewTool } from "./tools/get-pending-review.js";
import { listContentsWithPendingReview, resolveComment, resolveReview } from "./db/reviews.js";
import { insertErrorLog } from "./db/error-log.js";

const db = openDb();

const server = new McpServer({
  name: "knowledge-base",
  version: "1.0.0",
});

server.server.registerCapabilities({ sampling: {} });

async function requestSampling(prompt: string): Promise<string> {
  const result = await server.server.createMessage({
    messages: [{ role: "user", content: { type: "text", text: prompt } }],
    maxTokens: 500,
  });
  const content = result.content;
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && "text" in content) return (content as { text: string }).text;
  return "";
}

const contentTypeSchema = z.string().min(1);

function toText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function errorContent(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

server.tool(
  "create_content",
  "Creates a document in the knowledge base. Auto-creates the workspace and feature if they don't exist.",
  {
    workspace: z.string().min(1).describe("Workspace name (e.g. project slug)"),
    feature: z.string().min(1).describe("Feature or area name within the workspace"),
    type: contentTypeSchema.describe("Document type. Suggested: idea | spec | plan | digest | doc. Any non-empty string is accepted."),
    title: z.string().min(1).optional().describe("Short label for the document (optional, displayed in list/search results)"),
    body: z.string().min(1).describe("Document body text"),
  },
  async ({ workspace, feature, type, title, body }) => {
    try {
      const result = await createContent(db, workspace, feature, type, body, title, requestSampling);
      return { content: [{ type: "text", text: toText(result) }] };
    } catch (err) {
      insertErrorLog(db, "create_content", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

server.tool(
  "get_content",
  "Fetches a single document by its numeric ID.",
  {
    id: z.number().int().positive().describe("Document ID returned by create_content or search_content"),
  },
  async ({ id }) => {
    try {
      const result = getContent(db, id);
      return { content: [{ type: "text", text: toText(result) }] };
    } catch (err) {
      insertErrorLog(db, "get_content", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

server.tool(
  "list_contents",
  "Lists documents in a workspace. Optionally filter by feature and/or type.",
  {
    workspace: z.string().min(1).describe("Workspace to list documents from"),
    feature: z.string().optional().describe("Filter to a specific feature"),
    type: contentTypeSchema.optional().describe("Filter by type. Suggested: idea | spec | plan | digest | doc. Any non-empty string is accepted."),
  },
  async ({ workspace, feature, type }) => {
    try {
      const results = listContents(db, workspace, feature, type);
      return { content: [{ type: "text", text: toText(results) }] };
    } catch (err) {
      insertErrorLog(db, "list_contents", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

server.tool(
  "search_semantic",
  "Semantic search across document bodies using vector similarity (multilingual, 50+ languages). Returns documents ordered by semantic similarity to the query. Requires `npx @vulhdev/knowledge-base init` to be run first to download the embedding model.",
  {
    query: z.string().min(1).describe("Search query — any natural language, including Vietnamese"),
    workspace: z.string().optional().describe("Scope search to a specific workspace"),
    type: contentTypeSchema.optional().describe("Filter results by type. Suggested: idea | spec | plan | digest | doc. Any non-empty string is accepted."),
    limit: z.number().int().positive().max(50).default(10).describe("Max results to return (1–50, default 10)"),
    offset: z.number().int().min(0).default(0).describe("Skip first N results (for pagination)"),
  },
  async ({ query, workspace, type, limit, offset }) => {
    try {
      const page = await searchSemantic(db, query, workspace, type, limit, offset);
      return { content: [{ type: "text", text: toText(page) }] };
    } catch (err) {
      insertErrorLog(db, "search_semantic", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

server.tool(
  "update_content",
  "Updates the body (and optionally the type and title) of an existing document by its numeric ID. Returns the full updated document.",
  {
    id: z.number().int().positive().describe("Document ID returned by create_content or search_content"),
    body: z.string().min(1).describe("New document body text (replaces existing body)"),
    type: contentTypeSchema.optional().describe("New document type (omit to keep existing type). Suggested: idea | spec | plan | digest | doc. Any non-empty string is accepted."),
    title: z.string().min(1).optional().describe("New title (omit to keep existing title)"),
  },
  async ({ id, body, type, title }) => {
    try {
      const result = await updateContent(db, id, body, type, title);
      return { content: [{ type: "text", text: toText(result) }] };
    } catch (err) {
      insertErrorLog(db, "update_content", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

server.tool(
  "delete_content",
  "Permanently deletes a document by its numeric ID. Returns the deleted document.",
  {
    id: z.number().int().positive().describe("Document ID to delete"),
  },
  async ({ id }) => {
    try {
      const result = deleteContent(db, id);
      return { content: [{ type: "text", text: toText(result) }] };
    } catch (err) {
      insertErrorLog(db, "delete_content", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

server.tool(
  "link_content",
  "Links two existing documents as parent → child. Use after both documents exist. Emits a direction_warning if the type order is reversed (e.g. plan→idea) but does not block the operation.",
  {
    child_id: z.number().int().positive().describe("ID of the child document"),
    parent_id: z.number().int().positive().describe("ID of the parent document"),
  },
  async ({ child_id, parent_id }) => {
    try {
      const result = linkContent(db, child_id, parent_id);
      return { content: [{ type: "text", text: toText(result) }] };
    } catch (err) {
      insertErrorLog(db, "link_content", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

server.tool(
  "derive_content",
  "Creates a new document linked to a parent in a single step. Inherits the parent's workspace and feature. Returns the new document plus a parent_id field.",
  {
    parent_id: z.number().int().positive().describe("ID of the parent document to derive from"),
    type: contentTypeSchema.describe("Type of the new document. Suggested: idea | spec | plan | digest | doc."),
    body: z.string().min(1).describe("Document body text"),
    title: z.string().min(1).optional().describe("Short label for the document (optional)"),
  },
  async ({ parent_id, type, body, title }) => {
    try {
      const result = await deriveContent(db, parent_id, type, body, title);
      return { content: [{ type: "text", text: toText(result) }] };
    } catch (err) {
      insertErrorLog(db, "derive_content", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

server.tool(
  "get_lineage",
  "Returns the full ancestry chain for a document: all ancestors (nearest→oldest) and all descendants (BFS order). Use to answer 'which idea caused this spec?' or 'what has this idea produced?'",
  {
    content_id: z.number().int().positive().describe("ID of the document to get lineage for"),
  },
  async ({ content_id }) => {
    try {
      const result = getLineage(db, content_id);
      return { content: [{ type: "text", text: toText(result) }] };
    } catch (err) {
      insertErrorLog(db, "get_lineage", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

server.tool(
  "attach_code_ref",
  "Links a git commit to a knowledge-base document (primarily a plan) at task granularity. Call after each task commit so that resuming a plan in a new session shows which tasks already have commits.",
  {
    content_id: z.number().int().positive().describe("ID of the plan (or any content) to attach the commit to"),
    commit_hash: z.string().min(1).describe("Full or short git commit hash"),
    file_paths: z
      .array(z.object({ path: z.string().min(1), start: z.number().int().optional(), end: z.number().int().optional() }))
      .describe("Files changed in this commit, with optional line ranges"),
    task_ref: z.string().min(1).optional().describe("Free-text label matching a task in the plan body (e.g. 'Task 2: Setup session middleware')"),
  },
  async ({ content_id, commit_hash, file_paths, task_ref }) => {
    try {
      const result = attachCodeRef(db, content_id, commit_hash, file_paths, task_ref);
      return { content: [{ type: "text", text: toText(result) }] };
    } catch (err) {
      insertErrorLog(db, "attach_code_ref", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

server.tool(
  "get_code_refs",
  "Returns all git commits linked to a document, grouped by task. Use when resuming a plan to see which tasks already have commits and which don't.",
  {
    content_id: z.number().int().positive().describe("ID of the document to fetch code refs for"),
  },
  async ({ content_id }) => {
    try {
      const result = getCodeRefs(db, content_id);
      return { content: [{ type: "text", text: toText(result) }] };
    } catch (err) {
      insertErrorLog(db, "get_code_refs", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

server.tool(
  "open_for_review",
  "Creates a review session for a document and returns a GUI URL where the user can add inline comments. The GUI server must be running: npx @vulhdev/knowledge-base gui",
  {
    content_id: z.number().int().positive().describe("ID of the document to review"),
    port: z.number().int().positive().default(57891).optional().describe("Port the GUI server is running on (default 57891)"),
  },
  async ({ content_id, port }) => {
    try {
      const result = openForReview(db, content_id, port);
      return { content: [{ type: "text", text: toText(result) }] };
    } catch (err) {
      insertErrorLog(db, "open_for_review", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

server.tool(
  "wait_for_review",
  "Long-polls until the user commits a review for the given document, then returns all comments. Throws with instructions if the timeout is reached.",
  {
    content_id: z.number().int().positive().describe("ID of the document being reviewed"),
    timeout_seconds: z.number().int().positive().default(300).optional().describe("Max seconds to wait before timing out (default 300)"),
  },
  async ({ content_id, timeout_seconds }) => {
    try {
      const result = await waitForReview(db, content_id, timeout_seconds);
      return { content: [{ type: "text", text: toText(result) }] };
    } catch (err) {
      insertErrorLog(db, "wait_for_review", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

server.tool(
  "get_pending_review",
  "Returns the most recent committed review and its comments for a document. Use in the /knowledge-base-review skill fallback after a wait_for_review timeout.",
  {
    content_id: z.number().int().positive().describe("ID of the document to fetch the committed review for"),
  },
  async ({ content_id }) => {
    try {
      const result = getPendingReviewTool(db, content_id);
      return { content: [{ type: "text", text: toText(result) }] };
    } catch (err) {
      insertErrorLog(db, "get_pending_review", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

server.tool(
  "list_contents_with_pending_review",
  "Lists all documents that have at least one committed (unprocessed) review. Used by the /knowledge-base-review skill to show the user which documents are awaiting feedback processing.",
  {},
  async () => {
    try {
      const results = listContentsWithPendingReview(db);
      return { content: [{ type: "text", text: toText(results) }] };
    } catch (err) {
      insertErrorLog(db, "list_contents_with_pending_review", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

server.tool(
  "resolve_comment",
  "Marks a single review comment as resolved after Claude has processed it (applied an edit, answered a clarification, etc.). Call once per comment in the /knowledge-base-resolve-feedback flow.",
  { comment_id: z.number().int().positive().describe("ID of the review_comment to mark resolved") },
  async ({ comment_id }) => {
    try {
      const result = resolveComment(db, comment_id);
      return { content: [{ type: "text", text: toText(result) }] };
    } catch (err) {
      insertErrorLog(db, "resolve_comment", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

server.tool(
  "resolve_review",
  "Marks an entire review as resolved after all comments have been processed. Call at the end of the /knowledge-base-resolve-feedback flow.",
  { review_id: z.number().int().positive().describe("ID of the review to mark resolved") },
  async ({ review_id }) => {
    try {
      const result = resolveReview(db, review_id);
      return { content: [{ type: "text", text: toText(result) }] };
    } catch (err) {
      insertErrorLog(db, "resolve_review", err instanceof Error ? err.message : String(err));
      return errorContent(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
