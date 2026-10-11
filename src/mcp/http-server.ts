import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { validateSession, createSession } from "../auth/sessions.js";
import { authCtx } from "../auth/middleware.js";
import { initiateDeviceFlow, pollDeviceFlow } from "../auth/device-flow.js";

type Session = { transport: StreamableHTTPServerTransport };

export type McpHttpAppOpts = {
  clientId?: string;
};

function isInitializeRequest(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as Record<string, unknown>).method === "initialize"
  );
}

export function createMcpHttpApp(
  db: Database.Database,
  server: McpServer,
  opts: McpHttpAppOpts = {}
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

  // Public: CLI device flow — initiate
  app.post("/auth/device", async (req, res): Promise<void> => {
    const clientId = opts.clientId;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      res.status(503).json({ error: "Server not configured for GitHub OAuth (missing client_id or GITHUB_CLIENT_SECRET)" });
      return;
    }
    try {
      const result = await initiateDeviceFlow(clientId);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Public: CLI device flow — poll
  app.post("/auth/device/token", async (req, res): Promise<void> => {
    const clientId = opts.clientId;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      res.status(503).json({ error: "Server not configured for GitHub OAuth (missing client_id or GITHUB_CLIENT_SECRET)" });
      return;
    }
    const { device_code } = req.body as { device_code?: string };
    if (!device_code) {
      res.status(400).json({ error: "device_code is required" });
      return;
    }
    try {
      const result = await pollDeviceFlow(clientId, clientSecret, device_code);
      if ("pending" in result && result.pending) {
        res.json({ pending: true });
        return;
      }
      const { github_login } = result as { access_token: string; github_login: string };
      const sessionToken = createSession(db, github_login);
      res.json({ session_token: sessionToken, github_login });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("expired_token")) {
        res.status(410).json({ error: msg });
      } else {
        res.status(502).json({ error: msg });
      }
    }
  });

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
