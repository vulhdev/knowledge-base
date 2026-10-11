import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTestDb } from "../setup.js";
import { createMcpHttpApp } from "../../src/mcp/http-server.js";

vi.mock("../../src/auth/device-flow.js", () => ({
  initiateDeviceFlow: vi.fn(),
  pollDeviceFlow: vi.fn(),
}));

function makeApp(clientId?: string) {
  const db = createTestDb();
  const server = new McpServer({ name: "test", version: "0.0.1" });
  return { app: createMcpHttpApp(db, server, { clientId }), db };
}

describe("POST /auth/device", () => {
  beforeEach(() => {
    process.env.GITHUB_CLIENT_SECRET = "test-secret";
  });
  afterEach(() => {
    delete process.env.GITHUB_CLIENT_SECRET;
    vi.clearAllMocks();
  });

  it("returns 503 when clientId not configured", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/auth/device").send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toContain("not configured");
  });

  it("returns 503 when GITHUB_CLIENT_SECRET not set", async () => {
    delete process.env.GITHUB_CLIENT_SECRET;
    const { app } = makeApp("client-id");
    const res = await request(app).post("/auth/device").send({});
    expect(res.status).toBe(503);
  });

  it("returns device flow response from GitHub", async () => {
    const { initiateDeviceFlow } = await import("../../src/auth/device-flow.js");
    vi.mocked(initiateDeviceFlow).mockResolvedValueOnce({
      device_code: "devcode",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      interval: 5,
      expires_in: 900,
    });
    const { app } = makeApp("client-id");
    const res = await request(app).post("/auth/device").send({});
    expect(res.status).toBe(200);
    expect(res.body.user_code).toBe("ABCD-1234");
    expect(res.body.device_code).toBe("devcode");
  });

  it("returns 502 when GitHub is unreachable", async () => {
    const { initiateDeviceFlow } = await import("../../src/auth/device-flow.js");
    vi.mocked(initiateDeviceFlow).mockRejectedValueOnce(new Error("fetch failed"));
    const { app } = makeApp("client-id");
    const res = await request(app).post("/auth/device").send({});
    expect(res.status).toBe(502);
  });
});

describe("POST /auth/device/token", () => {
  beforeEach(() => {
    process.env.GITHUB_CLIENT_SECRET = "test-secret";
  });
  afterEach(() => {
    delete process.env.GITHUB_CLIENT_SECRET;
    vi.clearAllMocks();
  });

  it("returns 400 when device_code is missing", async () => {
    const { app } = makeApp("client-id");
    const res = await request(app).post("/auth/device/token").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("device_code");
  });

  it("returns 503 when server not configured", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/auth/device/token").send({ device_code: "x" });
    expect(res.status).toBe(503);
  });

  it("returns { pending: true } when authorization is pending", async () => {
    const { pollDeviceFlow } = await import("../../src/auth/device-flow.js");
    vi.mocked(pollDeviceFlow).mockResolvedValueOnce({ pending: true });
    const { app } = makeApp("client-id");
    const res = await request(app).post("/auth/device/token").send({ device_code: "devcode" });
    expect(res.status).toBe(200);
    expect(res.body.pending).toBe(true);
  });

  it("returns session_token when user authorizes", async () => {
    const { pollDeviceFlow } = await import("../../src/auth/device-flow.js");
    vi.mocked(pollDeviceFlow).mockResolvedValueOnce({ access_token: "gh-token", github_login: "alice" });
    const { app } = makeApp("client-id");
    const res = await request(app).post("/auth/device/token").send({ device_code: "devcode" });
    expect(res.status).toBe(200);
    expect(res.body.session_token).toBeTruthy();
    expect(res.body.github_login).toBe("alice");
  });

  it("returns 410 for expired device code", async () => {
    const { pollDeviceFlow } = await import("../../src/auth/device-flow.js");
    vi.mocked(pollDeviceFlow).mockRejectedValueOnce(new Error("expired_token: device code has expired"));
    const { app } = makeApp("client-id");
    const res = await request(app).post("/auth/device/token").send({ device_code: "old-code" });
    expect(res.status).toBe(410);
  });
});
