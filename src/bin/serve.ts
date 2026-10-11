#!/usr/bin/env node
import { createServer } from "node:net";
import { openDb } from "../db/client.js";
import { createKbServer } from "../mcp/create-server.js";
import { createApp } from "../gui/server.js";
import { createMcpHttpApp } from "../mcp/http-server.js";
import { loadSettings } from "../config.js";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port);
  });
}

async function findAvailablePort(start: number): Promise<number> {
  let port = start;
  while (!(await isPortAvailable(port))) port++;
  return port;
}

const settings = loadSettings();

let db;
try {
  db = openDb();
} catch (err) {
  console.error(`Error opening database: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const preferredGuiPort = settings.gui_port ?? Number(process.env.KB_GUI_PORT ?? 57891);
const preferredMcpPort = settings.mcp_port ?? Number(process.env.KB_MCP_PORT ?? 58000);

const [guiPort, mcpPort] = await Promise.all([
  findAvailablePort(preferredGuiPort),
  findAvailablePort(preferredMcpPort),
]);

if (guiPort !== preferredGuiPort) {
  console.log(`Port ${preferredGuiPort} in use, GUI using ${guiPort} instead.`);
}
if (mcpPort !== preferredMcpPort) {
  console.log(`Port ${preferredMcpPort} in use, MCP using ${mcpPort} instead.`);
}

const mcpServer = createKbServer(db, { guiPort });
const guiApp = createApp(db, { authMode: true });
const mcpApp = createMcpHttpApp(db, mcpServer, { clientId: settings.github_client_id });

guiApp.listen(guiPort, "127.0.0.1", () => {
  console.log(`knowledge-base GUI listening on http://127.0.0.1:${guiPort}`);
});

mcpApp.listen(mcpPort, "0.0.0.0", () => {
  console.log(`knowledge-base MCP HTTP listening on http://0.0.0.0:${mcpPort}`);
  console.log(`  Configure Claude Code: knowledge-base login --server http://<your-host>:${mcpPort}`);
});
