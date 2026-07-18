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
  },
  async ({ query, workspace, type, limit }) => {
    try {
      const results = await searchSemantic(db, query, workspace, type, limit);
      return { content: [{ type: "text", text: toText(results) }] };
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

const transport = new StdioServerTransport();
await server.connect(transport);
