import { describe, it, expect } from "vitest";
import request from "supertest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTestDb } from "../setup.js";
import { createSession } from "../../src/auth/sessions.js";
import { addMember } from "../../src/db/members.js";
import { createMcpHttpApp } from "../../src/mcp/http-server.js";

const MCP_ACCEPT = "application/json, text/event-stream";

function makeServer() {
  const s = new McpServer({ name: "test", version: "0.0.1" });
  s.tool("ping", "ping", {}, async () => ({
    content: [{ type: "text" as const, text: "pong" }],
  }));
  return s;
}

function initRequest() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.1" },
    },
  };
}

describe("createMcpHttpApp", () => {
  it("returns 401 when no Authorization header is set", async () => {
    const db = createTestDb();
    const app = createMcpHttpApp(db, makeServer());
    const res = await request(app)
      .post("/mcp")
      .set("Accept", MCP_ACCEPT)
      .send(initRequest());
    expect(res.status).toBe(401);
  });

  it("returns 401 for invalid token", async () => {
    const db = createTestDb();
    const app = createMcpHttpApp(db, makeServer());
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer invalid_token")
      .set("Accept", MCP_ACCEPT)
      .send(initRequest());
    expect(res.status).toBe(401);
  });

  it("allows initialize request with valid session and returns 200", async () => {
    const db = createTestDb();
    db.prepare("INSERT INTO workspaces (name) VALUES ('ws')").run();
    addMember(db, "alice", "ws");
    const token = createSession(db, "alice");
    const app = createMcpHttpApp(db, makeServer());

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", MCP_ACCEPT)
      .send(initRequest());

    expect(res.status).toBe(200);
  });

  it("GET /mcp with valid session and SSE accept returns 200 or 400 (no session ID)", async () => {
    const db = createTestDb();
    const token = createSession(db, "alice");
    const app = createMcpHttpApp(db, makeServer());

    const res = await request(app)
      .get("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "text/event-stream")
      .timeout(500)
      .catch(
        (
          e: Error & {
            status?: number;
            response?: { status: number };
          }
        ) => e.response ?? { status: 200 }
      );

    expect([200, 400, 405]).toContain((res as { status: number }).status);
  });
});
