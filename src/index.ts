#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

process.env.DB_PATH ??= join(homedir(), ".claude", "knowledge-base.db");
import { openDb } from "./db/client.js";
import { createContent } from "./tools/create-content.js";
import { getContent } from "./tools/get-content.js";
import { listContents } from "./tools/list-contents.js";
import { searchContent } from "./tools/search-content.js";
import { updateContent } from "./tools/update-content.js";
import { deleteContent } from "./tools/delete-content.js";

const db = openDb();

const server = new McpServer({
  name: "knowledge-base",
  version: "1.0.0",
});

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
      const result = await createContent(db, workspace, feature, type, body, title);
      return { content: [{ type: "text", text: toText(result) }] };
    } catch (err) {
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
      return errorContent(err);
    }
  },
);

server.tool(
  "search_content",
  "Full-text search across document bodies using SQLite FTS5 with BM25 relevance ranking. Returns documents ordered by relevance (most relevant first).",
  {
    query: z.string().min(1).describe("Search query (FTS5 MATCH syntax supported)"),
    workspace: z.string().optional().describe("Scope search to a specific workspace"),
    type: contentTypeSchema.optional().describe("Filter results by type. Suggested: idea | spec | plan | digest | doc. Any non-empty string is accepted."),
    limit: z.number().int().positive().max(50).default(10).describe("Max results to return (1–50, default 10)"),
  },
  async ({ query, workspace, type, limit }) => {
    try {
      const results = searchContent(db, query, workspace, type, limit);
      return { content: [{ type: "text", text: toText(results) }] };
    } catch (err) {
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
      const result = updateContent(db, id, body, type, title);
      return { content: [{ type: "text", text: toText(result) }] };
    } catch (err) {
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
      return errorContent(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
