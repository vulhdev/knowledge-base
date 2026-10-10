import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { validateSession } from "../auth/sessions.js";
import { authCtx } from "../auth/middleware.js";

type Session = { transport: StreamableHTTPServerTransport };

function isInitializeRequest(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as Record<string, unknown>).method === "initialize"
  );
}

export function createMcpHttpApp(
  db: Database.Database,
  server: McpServer
): express.Application {
  const sessions = new Map<string, Session>();
  const app = express();
  app.use(express.json());

  function authenticate(
    req: express.Request,
    res: express.Response
  ): { github_login: string } | null {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized: missing Bearer token" });
      return null;
    }
    const raw = authHeader.slice(7);
    const ctx = validateSession(db, raw);
    if (!ctx) {
      res.status(401).json({ error: "Unauthorized: invalid or expired token" });
      return null;
    }
    return ctx;
  }

  const route = async (
    req: express.Request,
    res: express.Response
  ): Promise<void> => {
    const ctx = authenticate(req, res);
    if (!ctx) return;

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const existing = sessionId ? sessions.get(sessionId) : undefined;

    if (existing) {
      await authCtx.run(ctx, () =>
        existing.transport.handleRequest(req, res, req.body)
      );
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      await authCtx.run(ctx, () =>
        transport.handleRequest(req, res, req.body)
      );
      return;
    }

    if (sessionId) {
      res
        .status(404)
        .json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
      return;
    }

    res
      .status(400)
      .json({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: Session ID required" }, id: null });
  };

  app.post("/mcp", route);
  app.get("/mcp", route);
  app.delete("/mcp", route);

  return app;
}
