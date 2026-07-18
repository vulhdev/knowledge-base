import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { insertErrorLog } from "../../src/db/error-log.js";
import { createApp } from "../../src/gui/server.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

vi.mock("../../src/tools/search-semantic.js", () => ({
  searchSemantic: vi.fn().mockResolvedValue([]),
}));

describe("GUI server routes", () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = createTestDb();
    await createContent(db, "proj-a", "auth", "spec", "## Auth\n\nUses **JWT** tokens.", "Auth Spec");
    await createContent(db, "proj-a", "auth", "idea", "Some auth idea");
    await createContent(db, "proj-a", "search", "plan", "Search plan body");
    await createContent(db, "proj-b", "payments", "idea", "Payments idea");
    app = createApp(db);
  });

  describe("GET /", () => {
    it("returns 200 with workspace links", async () => {
      const res = await request(app).get("/");
      expect(res.status).toBe(200);
      expect(res.text).toContain("proj-a");
      expect(res.text).toContain("proj-b");
    });
  });

  describe("GET /ws/:workspace", () => {
    it("returns 200 with feature links for known workspace", async () => {
      const res = await request(app).get("/ws/proj-a");
      expect(res.status).toBe(200);
      expect(res.text).toContain("auth");
      expect(res.text).toContain("search");
    });

    it("returns 404 for unknown workspace", async () => {
      const res = await request(app).get("/ws/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /ws/:workspace/:feature", () => {
    it("returns 200 with content list", async () => {
      const res = await request(app).get("/ws/proj-a/auth");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Auth Spec");
    });

    it("returns 404 for unknown feature", async () => {
      const res = await request(app).get("/ws/proj-a/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /ws/:workspace/:feature/:id", () => {
    it("returns 200 and renders Markdown body as HTML", async () => {
      const contents = db
        .prepare(
          `SELECT c.id FROM contents c
           JOIN features f ON c.feature_id = f.id
           JOIN workspaces w ON f.workspace_id = w.id
           WHERE w.name = 'proj-a' AND f.name = 'auth' AND c.title = 'Auth Spec'`,
        )
        .all() as { id: number }[];
      const id = contents[0].id;

      const res = await request(app).get(`/ws/proj-a/auth/${id}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain("<h2>Auth</h2>");
      expect(res.text).toContain("<strong>JWT</strong>");
    });

    it("returns 404 for unknown id", async () => {
      const res = await request(app).get("/ws/proj-a/auth/99999");
      expect(res.status).toBe(404);
    });

    it("returns 404 for invalid id", async () => {
      const res = await request(app).get("/ws/proj-a/auth/not-a-number");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /assets/:file", () => {
    it("serves the logo image with 200", async () => {
      const res = await request(app).get("/assets/kb-lockup-tagline-dark.png");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/image\/png/);
    });
  });

  describe("GET /search", () => {
    it("returns 200 with results for a matching query", async () => {
      const res = await request(app).get("/search?q=auth");
      expect(res.status).toBe(200);
      expect(res.text).toContain("auth");
    });

    it("redirects to / when q is missing", async () => {
      const res = await request(app).get("/search");
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/");
    });

    it("accepts workspace filter", async () => {
      const res = await request(app).get("/search?q=auth&workspace=proj-a");
      expect(res.status).toBe(200);
      expect(res.text).toContain("proj-a");
    });
  });

  describe("GET /errors", () => {
    it("returns 200 with empty-state message when no errors exist", async () => {
      const res = await request(app).get("/errors");
      expect(res.status).toBe(200);
      expect(res.text).toContain("No errors recorded");
    });

    it("returns 200 and renders error rows when errors exist", async () => {
      insertErrorLog(db, "get_content", "Content not found");
      const res = await request(app).get("/errors");
      expect(res.status).toBe(200);
      expect(res.text).toContain("get_content");
      expect(res.text).toContain("Content not found");
    });

    it("shows errors newest-first", async () => {
      insertErrorLog(db, "tool_a", "first error");
      insertErrorLog(db, "tool_b", "second error");
      const res = await request(app).get("/errors");
      expect(res.text.indexOf("tool_b")).toBeLessThan(res.text.indexOf("tool_a"));
    });
  });

  describe("nav link", () => {
    it("includes Errors link on the home page", async () => {
      const res = await request(app).get("/");
      expect(res.status).toBe(200);
      expect(res.text).toContain('href="/errors"');
    });
  });
});
