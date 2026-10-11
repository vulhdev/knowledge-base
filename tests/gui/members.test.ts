import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestDb } from "../setup.js";
import { createApp } from "../../src/gui/server.js";
import { addMember } from "../../src/db/members.js";

function seedWorkspace(db: ReturnType<typeof createTestDb>, name = "myws") {
  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(name);
}

describe("GET /ws/:workspace/members", () => {
  it("returns HTML with 'No members yet' when workspace is empty", async () => {
    const db = createTestDb();
    seedWorkspace(db);
    const app = createApp(db);
    const res = await request(app).get("/ws/myws/members");
    expect(res.status).toBe(200);
    expect(res.text).toContain("No members yet");
  });

  it("lists existing members", async () => {
    const db = createTestDb();
    seedWorkspace(db);
    addMember(db, "alice", "myws", "owner");
    const app = createApp(db);
    const res = await request(app).get("/ws/myws/members");
    expect(res.status).toBe(200);
    expect(res.text).toContain("alice");
  });
});

describe("POST /ws/:workspace/members", () => {
  it("adds a member and returns 201", async () => {
    const db = createTestDb();
    seedWorkspace(db);
    const app = createApp(db);
    const res = await request(app)
      .post("/ws/myws/members")
      .send({ github_login: "bob" });
    expect(res.status).toBe(201);
    expect(res.body.github_login).toBe("bob");
  });

  it("returns 400 when github_login is missing", async () => {
    const db = createTestDb();
    seedWorkspace(db);
    const app = createApp(db);
    const res = await request(app).post("/ws/myws/members").send({});
    expect(res.status).toBe(400);
  });
});

describe("DELETE /ws/:workspace/members/:login", () => {
  it("removes a member and returns 204", async () => {
    const db = createTestDb();
    seedWorkspace(db);
    addMember(db, "alice", "myws");
    const app = createApp(db);
    const res = await request(app).delete("/ws/myws/members/alice");
    expect(res.status).toBe(204);
  });

  it("returns 204 even when member does not exist (no-op)", async () => {
    const db = createTestDb();
    seedWorkspace(db);
    const app = createApp(db);
    const res = await request(app).delete("/ws/myws/members/ghost");
    expect(res.status).toBe(204);
  });
});
