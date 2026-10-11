import { describe, it, expect } from "vitest";
import request from "supertest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTestDb } from "../setup.js";
import { createMcpHttpApp } from "../../src/mcp/http-server.js";
import { createSession } from "../../src/auth/sessions.js";
import { addMember } from "../../src/db/members.js";

function makeApp() {
  const db = createTestDb();
  const server = new McpServer({ name: "test", version: "0.0.1" });
  const app = createMcpHttpApp(db, server);
  return { app, db };
}

function makeAuthedApp() {
  const { app, db } = makeApp();
  const aliceToken = createSession(db, "alice");
  const bobToken = createSession(db, "bob");
  return { app, db, aliceToken, bobToken };
}

const ITEMS = [
  { feature: "auth", type: "spec", title: "Auth Spec", body: "Auth body" },
  { feature: "auth", type: "plan", body: "Plan body" },
];

describe("POST /api/import", () => {
  it("returns 401 without token", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/api/import").send({ workspace: "ws", items: ITEMS });
    expect(res.status).toBe(401);
  });

  it("returns 400 when workspace is missing", async () => {
    const { app, aliceToken } = makeAuthedApp();
    const res = await request(app)
      .post("/api/import")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ items: ITEMS });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("workspace");
  });

  it("returns 400 when items is empty", async () => {
    const { app, aliceToken } = makeAuthedApp();
    const res = await request(app)
      .post("/api/import")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ workspace: "ws", items: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when item is missing body", async () => {
    const { app, aliceToken } = makeAuthedApp();
    const res = await request(app)
      .post("/api/import")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ workspace: "ws", items: [{ feature: "f", type: "doc" }] });
    expect(res.status).toBe(400);
  });

  it("creates contents and returns session_id", async () => {
    const { app, db, aliceToken } = makeAuthedApp();
    const res = await request(app)
      .post("/api/import")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ workspace: "ws", items: ITEMS });

    expect(res.status).toBe(200);
    expect(res.body.session_id).toBeTruthy();
    expect(res.body.imported).toBe(2);

    const session = db
      .prepare("SELECT * FROM import_sessions WHERE id = ?")
      .get(res.body.session_id) as { github_login: string; workspace: string };
    expect(session.github_login).toBe("alice");
    expect(session.workspace).toBe("ws");

    const linked = db
      .prepare("SELECT COUNT(*) AS n FROM import_session_contents WHERE session_id = ?")
      .get(res.body.session_id) as { n: number };
    expect(linked.n).toBe(2);
  });

  it("creates workspace if it does not exist", async () => {
    const { app, db, aliceToken } = makeAuthedApp();
    await request(app)
      .post("/api/import")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ workspace: "brand-new", items: [{ feature: "f", type: "idea", body: "b" }] });

    const ws = db.prepare("SELECT id FROM workspaces WHERE name = 'brand-new'").get();
    expect(ws).toBeTruthy();
  });
});

describe("DELETE /api/import/:session_id", () => {
  async function createImport(app: ReturnType<typeof makeAuthedApp>["app"], token: string) {
    const res = await request(app)
      .post("/api/import")
      .set("Authorization", `Bearer ${token}`)
      .send({ workspace: "ws", items: ITEMS });
    return res.body.session_id as string;
  }

  it("returns 401 without token", async () => {
    const { app, aliceToken } = makeAuthedApp();
    const sid = await createImport(app, aliceToken);
    const res = await request(app).delete(`/api/import/${sid}`);
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown session", async () => {
    const { app, aliceToken } = makeAuthedApp();
    const res = await request(app)
      .delete("/api/import/nonexistent")
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(res.status).toBe(404);
  });

  it("owner can rollback their own import", async () => {
    const { app, db, aliceToken } = makeAuthedApp();
    const sid = await createImport(app, aliceToken);

    const contentsBefore = (db.prepare("SELECT COUNT(*) AS n FROM import_session_contents WHERE session_id = ?").get(sid) as { n: number }).n;
    expect(contentsBefore).toBe(2);

    const res = await request(app)
      .delete(`/api/import/${sid}`)
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.rolled_back).toBe(sid);

    const session = db.prepare("SELECT id FROM import_sessions WHERE id = ?").get(sid);
    expect(session).toBeUndefined();
    const contents = (db.prepare("SELECT COUNT(*) AS n FROM import_session_contents WHERE session_id = ?").get(sid) as { n: number }).n;
    expect(contents).toBe(0);
  });

  it("workspace admin can rollback another user's import", async () => {
    const { app, db, aliceToken, bobToken } = makeAuthedApp();
    addMember(db, "bob", "ws", undefined, "admin");
    const sid = await createImport(app, aliceToken);

    const res = await request(app)
      .delete(`/api/import/${sid}`)
      .set("Authorization", `Bearer ${bobToken}`);
    expect(res.status).toBe(200);
  });

  it("non-admin other user gets 403", async () => {
    const { app, aliceToken, bobToken } = makeAuthedApp();
    const sid = await createImport(app, aliceToken);

    const res = await request(app)
      .delete(`/api/import/${sid}`)
      .set("Authorization", `Bearer ${bobToken}`);
    expect(res.status).toBe(403);
  });

  it("cascade deletes contents from DB on rollback", async () => {
    const { app, db, aliceToken } = makeAuthedApp();
    const sid = await createImport(app, aliceToken);

    await request(app)
      .delete(`/api/import/${sid}`)
      .set("Authorization", `Bearer ${aliceToken}`);

    const orphans = (db.prepare("SELECT COUNT(*) AS n FROM import_session_contents WHERE session_id = ?").get(sid) as { n: number }).n;
    expect(orphans).toBe(0);
  });
});
