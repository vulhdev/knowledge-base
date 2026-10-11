#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDb } from "./db/client.js";
import { createKbServer } from "./mcp/create-server.js";

const db = openDb();
const server = createKbServer(db);

const transport = new StdioServerTransport();
await server.connect(transport);
