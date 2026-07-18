#!/usr/bin/env node
import { createServer } from "node:net";
import { openDb } from "../db/client.js";
import { createApp } from "../gui/server.js";

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

let db;
try {
  db = openDb();
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const preferredPort = Number(process.env.PORT ?? 3000);
const port = await findAvailablePort(preferredPort);

if (port !== preferredPort) {
  console.log(`Port ${preferredPort} in use, using ${port} instead.`);
}

createApp(db).listen(port, () => {
  console.log(`knowledge-base gui listening on http://localhost:${port}`);
});
