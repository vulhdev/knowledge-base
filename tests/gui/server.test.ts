import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { DatabaseSync } from "node:sqlite";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { createApp } from "../../src/gui/server.js";

describe("GUI server routes", () => {
  let db: DatabaseSync;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createTestDb();
    createContent(db, "proj-a", "auth", "spec", "## Auth\n\nUses **JWT** tokens.", "Auth Spec");
    createContent(db, "proj-a", "auth", "idea", "Some auth idea");
    createContent(db, "proj-a", "search", "plan", "Search plan body");
    createContent(db, "proj-b", "payments", "idea", "Payments idea");
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
});
