import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createApp } from "../../src/gui/server.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

vi.mock("../../src/config.js", () => ({
  loadSettings: vi.fn(),
}));

const HOST_SETTINGS = {
  db_path: "/db",
  model_cache_dir: "/m",
  workspaces: { "proj-a": { team: { role: "host", secret: "s", noise_keypair: { publicKey: "pk", secretKey: "sk" } } } },
};
const PEER_SETTINGS = {
  db_path: "/db",
  model_cache_dir: "/m",
  workspaces: { "proj-a": { team: { role: "peer", secret: "s", noise_keypair: { publicKey: "pk", secretKey: "sk" } } } },
};
const NO_TEAM_SETTINGS = { db_path: "/db", model_cache_dir: "/m" };

async function mockSettings(settings: object) {
  const { loadSettings } = await import("../../src/config.js");
  vi.mocked(loadSettings).mockReturnValue(settings as ReturnType<typeof loadSettings>);
}

// --- renderTeamPage unit tests ---

describe("renderTeamPage", () => {
  it("renders empty-state when no peers", async () => {
    const { renderTeamPage } = await import("../../src/gui/render/team.js");
    const html = renderTeamPage("my-ws", []);
    expect(html).toContain("empty-state");
    expect(html).toContain("knowledge-base team invite");
  });

  it("renders active peer with bullet and Remove button", async () => {
    const { renderTeamPage } = await import("../../src/gui/render/team.js");
    const peers = [{
      public_key: "pk1", display_name: "@alice", github_username: "alice",
      is_active: 1, joined_at: "2026-10-01 00:00:00",
    }];
    const html = renderTeamPage("my-ws", peers);
    expect(html).toContain("●");
    expect(html).toContain("@alice");
    expect(html).toContain(`method="post"`);
    expect(html).toContain("Remove");
  });

  it("renders kicked peer with circle and no Remove button", async () => {
    const { renderTeamPage } = await import("../../src/gui/render/team.js");
    const peers = [{
      public_key: "pk1", display_name: "@bob", github_username: "bob",
      is_active: 0, joined_at: "2026-09-20 00:00:00",
    }];
    const html = renderTeamPage("my-ws", peers);
    expect(html).toContain("○");
    expect(html).toContain("kicked");
    expect(html).not.toContain(`/team/kick`);
    expect(html).toContain(`/team/delete`);
  });

  it("escapes XSS in github_username", async () => {
    const { renderTeamPage } = await import("../../src/gui/render/team.js");
    const peers = [{
      public_key: "pk1", display_name: "<script>", github_username: "<script>alert(1)</script>",
      is_active: 1, joined_at: "2026-10-01 00:00:00",
    }];
    const html = renderTeamPage("my-ws", peers);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("esc() helper", () => {
  it("SEC-7: escapes single quotes as &#39;", async () => {
    const { esc } = await import("../../src/gui/render/_layout.js");
    expect(esc("it's")).toBe("it&#39;s");
  });

  it("SEC-7: confirm team confirmMsg uses raw username (no double-escape)", async () => {
    const { renderTeamPage } = await import("../../src/gui/render/team.js");
    const peers = [{
      public_key: "pk1", display_name: "@alice", github_username: "alice",
      is_active: 1, joined_at: "2026-10-01 00:00:00",
    }];
    const html = renderTeamPage("my-ws", peers);
    expect(html).toContain("Remove @alice from team?");
    expect(html).not.toContain("&amp;");
  });
});

// --- Route tests ---

describe("GET /ws/:workspace/team", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = createTestDb();
    await mockSettings(HOST_SETTINGS);
    app = createApp(db);
  });

  it("returns 200 for host", async () => {
    const res = await request(app).get("/ws/proj-a/team");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Team Members");
  });

  it("returns 403 for peer", async () => {
    await mockSettings(PEER_SETTINGS);
    const res = await request(app).get("/ws/proj-a/team");
    expect(res.status).toBe(403);
  });

  it("returns 403 when no team config", async () => {
    await mockSettings(NO_TEAM_SETTINGS);
    const res = await request(app).get("/ws/proj-a/team");
    expect(res.status).toBe(403);
  });
});

describe("POST /ws/:workspace/team/kick", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = createTestDb();
    db.prepare("INSERT INTO team_peers (public_key, display_name, github_username) VALUES (?, ?, ?)").run("pk1", "@alice", "alice");
    await mockSettings(HOST_SETTINGS);
    app = createApp(db);
  });

  it("kicks active member and redirects 302", async () => {
    const res = await request(app)
      .post("/ws/proj-a/team/kick")
      .set("Origin", "http://localhost")
      .send({ github_username: "alice" });
    expect(res.status).toBe(302);
    const row = db.prepare("SELECT is_active FROM team_peers WHERE github_username = 'alice'").get() as { is_active: number };
    expect(row.is_active).toBe(0);
  });

  it("SEC-6: kicks member via urlencoded form body", async () => {
    const res = await request(app)
      .post("/ws/proj-a/team/kick")
      .set("Origin", "http://localhost")
      .type("form")
      .send("github_username=alice");
    expect(res.status).toBe(302);
    const row = db.prepare("SELECT is_active FROM team_peers WHERE github_username = 'alice'").get() as { is_active: number };
    expect(row.is_active).toBe(0);
  });

  it("returns 400 for unknown username", async () => {
    const res = await request(app)
      .post("/ws/proj-a/team/kick")
      .set("Origin", "http://localhost")
      .send({ github_username: "ghost" });
    expect(res.status).toBe(400);
  });

  it("SEC-5: escapes github_username in 400 'not found' response", async () => {
    const res = await request(app)
      .post("/ws/proj-a/team/kick")
      .set("Origin", "http://localhost")
      .send({ github_username: "<script>alert(1)</script>" });
    expect(res.status).toBe(400);
    expect(res.text).not.toContain("<script>");
    expect(res.text).toContain("&lt;script&gt;");
  });

  it("SEC-5: escapes github_username in 400 'already inactive' response", async () => {
    db.prepare("UPDATE team_peers SET is_active = 0 WHERE github_username = 'alice'").run();
    const res = await request(app)
      .post("/ws/proj-a/team/kick")
      .set("Origin", "http://localhost")
      .send({ github_username: "alice<script>" });
    expect(res.status).toBe(400);
    expect(res.text).not.toContain("<script>");
  });

  it("returns 400 for already-kicked member", async () => {
    db.prepare("UPDATE team_peers SET is_active = 0 WHERE github_username = 'alice'").run();
    const res = await request(app)
      .post("/ws/proj-a/team/kick")
      .set("Origin", "http://localhost")
      .send({ github_username: "alice" });
    expect(res.status).toBe(400);
  });

  it("returns 403 for non-host", async () => {
    await mockSettings(PEER_SETTINGS);
    const res = await request(app)
      .post("/ws/proj-a/team/kick")
      .set("Origin", "http://localhost")
      .send({ github_username: "alice" });
    expect(res.status).toBe(403);
  });

  it("CORS-1: returns 403 when Origin header is missing", async () => {
    const res = await request(app)
      .post("/ws/proj-a/team/kick")
      .set("Origin", "")
      .send({ github_username: "alice" });
    expect(res.status).toBe(403);
  });

  it("CORS-1: returns 403 when Origin is a cross-origin domain", async () => {
    const res = await request(app)
      .post("/ws/proj-a/team/kick")
      .set("Origin", "https://evil.example.com")
      .send({ github_username: "alice" });
    expect(res.status).toBe(403);
  });

  it("CORS-1: allows kick when Origin is localhost", async () => {
    const res = await request(app)
      .post("/ws/proj-a/team/kick")
      .set("Origin", "http://localhost")
      .send({ github_username: "alice" });
    expect(res.status).toBe(302);
  });
});

describe("POST /ws/:workspace/team/kick — CSRF port check", () => {
  const TEST_PORT = 57891;
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = createTestDb();
    db.prepare("INSERT INTO team_peers (public_key, display_name, github_username) VALUES (?, ?, ?)").run("pk1", "@alice", "alice");
    await mockSettings(HOST_SETTINGS);
    app = createApp(db, TEST_PORT);
  });

  it("CSRF-14: allows kick when Origin port matches the server port", async () => {
    const res = await request(app)
      .post("/ws/proj-a/team/kick")
      .set("Origin", `http://localhost:${TEST_PORT}`)
      .send({ github_username: "alice" });
    expect(res.status).toBe(302);
  });

  it("CSRF-14: rejects kick when Origin port is wrong (different port = different app)", async () => {
    const res = await request(app)
      .post("/ws/proj-a/team/kick")
      .set("Origin", "http://localhost:8080")
      .send({ github_username: "alice" });
    expect(res.status).toBe(403);
  });

  it("CSRF-14: rejects kick when Origin has no port (defaults to 80, not the server port)", async () => {
    const res = await request(app)
      .post("/ws/proj-a/team/kick")
      .set("Origin", "http://localhost")
      .send({ github_username: "alice" });
    expect(res.status).toBe(403);
  });
});

// --- Task 3: Team link in workspace page ---

describe("GET /ws/:workspace — Team link", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    db.prepare("INSERT INTO workspaces (name) VALUES (?)").run("proj-a");
  });

  it("shows Team link for host workspace", async () => {
    await mockSettings(HOST_SETTINGS);
    const app = createApp(db);
    const res = await request(app).get("/ws/proj-a");
    expect(res.status).toBe(200);
    expect(res.text).toContain("/ws/proj-a/team");
  });

  it("hides Team link when no team config", async () => {
    await mockSettings(NO_TEAM_SETTINGS);
    const app = createApp(db);
    const res = await request(app).get("/ws/proj-a");
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("/ws/proj-a/team");
  });
});
