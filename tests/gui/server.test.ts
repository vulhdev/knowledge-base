import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { linkContent } from "../../src/tools/link-content.js";
import { insertErrorLog } from "../../src/db/error-log.js";
import { createApp } from "../../src/gui/server.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

vi.mock("../../src/tools/search-semantic.js", () => ({
  searchSemantic: vi.fn().mockResolvedValue({ results: [], has_more: false, total_in_pool: 0, offset: 0, limit: 10 }),
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

    it("renders workspace card grid instead of a table", async () => {
      const res = await request(app).get("/");
      expect(res.text).toContain("workspace-grid");
      expect(res.text).not.toContain("<table");
    });

    it("renders hero heading on home page", async () => {
      const res = await request(app).get("/");
      expect(res.text).toContain("Find answers across your workspace");
    });

    it("shows feature count in workspace card", async () => {
      const res = await request(app).get("/");
      expect(res.text).toContain("features");
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

    it("renders Export .md link pointing to /export route", async () => {
      const rows = db
        .prepare(
          `SELECT c.id FROM contents c
           JOIN features f ON c.feature_id = f.id
           JOIN workspaces w ON f.workspace_id = w.id
           WHERE w.name = 'proj-a' AND f.name = 'auth' AND c.title = 'Auth Spec'`,
        )
        .all() as { id: number }[];
      const id = rows[0].id;
      const res = await request(app).get(`/ws/proj-a/auth/${id}`);
      expect(res.text).toContain(`/ws/proj-a/auth/${id}/export`);
      expect(res.text).toContain("Export .md");
    });

    it("renders Copy button in meta row", async () => {
      const rows = db
        .prepare(
          `SELECT c.id FROM contents c
           JOIN features f ON c.feature_id = f.id
           JOIN workspaces w ON f.workspace_id = w.id
           WHERE w.name = 'proj-a' AND f.name = 'auth' AND c.title = 'Auth Spec'`,
        )
        .all() as { id: number }[];
      const id = rows[0].id;
      const res = await request(app).get(`/ws/proj-a/auth/${id}`);
      expect(res.text).toContain("action-btns");
      expect(res.text).toContain("Copy");
    });
  });

  describe("GET /ws/:workspace/:feature/:id/export", () => {
    let contentId: number;

    beforeEach(async () => {
      const rows = db
        .prepare(
          `SELECT c.id FROM contents c
           JOIN features f ON c.feature_id = f.id
           JOIN workspaces w ON f.workspace_id = w.id
           WHERE w.name = 'proj-a' AND f.name = 'auth' AND c.title = 'Auth Spec'`,
        )
        .all() as { id: number }[];
      contentId = rows[0].id;
    });

    it("returns 200 with text/markdown content-type", async () => {
      const res = await request(app).get(`/ws/proj-a/auth/${contentId}/export`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/markdown/);
    });

    it("sets Content-Disposition attachment with slugified filename", async () => {
      const res = await request(app).get(`/ws/proj-a/auth/${contentId}/export`);
      expect(res.headers["content-disposition"]).toMatch(/attachment/);
      expect(res.headers["content-disposition"]).toMatch(/auth-spec\.md/);
    });

    it("response body starts with YAML frontmatter block", async () => {
      const res = await request(app).get(`/ws/proj-a/auth/${contentId}/export`);
      expect(res.text).toMatch(/^---\n/);
    });

    it("frontmatter contains title, type, feature, workspace, exported fields", async () => {
      const res = await request(app).get(`/ws/proj-a/auth/${contentId}/export`);
      expect(res.text).toContain("title: Auth Spec");
      expect(res.text).toContain("type: spec");
      expect(res.text).toContain("feature: auth");
      expect(res.text).toContain("workspace: proj-a");
      expect(res.text).toMatch(/exported: \d{4}-\d{2}-\d{2}/);
    });

    it("response body contains original content body after frontmatter", async () => {
      const res = await request(app).get(`/ws/proj-a/auth/${contentId}/export`);
      expect(res.text).toContain("## Auth");
      expect(res.text).toContain("Uses **JWT** tokens.");
    });

    it("returns 404 for non-existent id", async () => {
      const res = await request(app).get("/ws/proj-a/auth/99999/export");
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-integer id", async () => {
      const res = await request(app).get("/ws/proj-a/auth/not-a-number/export");
      expect(res.status).toBe(404);
    });

    it("falls back to content-{id}.md when title is null", async () => {
      const rows = db
        .prepare(
          `SELECT c.id FROM contents c
           JOIN features f ON c.feature_id = f.id
           JOIN workspaces w ON f.workspace_id = w.id
           WHERE w.name = 'proj-a' AND f.name = 'auth' AND c.title IS NULL`,
        )
        .all() as { id: number }[];
      const id = rows[0].id;
      const res = await request(app).get(`/ws/proj-a/auth/${id}/export`);
      expect(res.headers["content-disposition"]).toMatch(new RegExp(`content-${id}\\.md`));
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

  describe("layout width", () => {
    it("renders with 1280px max-width on all pages", async () => {
      const res = await request(app).get("/");
      expect(res.status).toBe(200);
      expect(res.text).toContain("1280px");
    });
  });

  describe("dark theme", () => {
    it("does not load Pico CSS", async () => {
      const res = await request(app).get("/");
      expect(res.text).not.toContain("picocss");
    });

    it("loads Google Fonts", async () => {
      const res = await request(app).get("/");
      expect(res.text).toContain("fonts.googleapis.com");
    });

    it("uses dark background color token", async () => {
      const res = await request(app).get("/");
      expect(res.text).toContain("#0b141c");
    });
  });

  describe("linked content sidebar", () => {
    it("shows sidebar with parents and children when content has links", async () => {
      const parent = await createContent(db, "proj-a", "auth", "idea", "Parent idea body", "Parent Idea");
      const child = await createContent(db, "proj-a", "auth", "spec", "Child spec body", "Child Spec");
      linkContent(db, child.id, parent.id);

      const res = await request(app).get(`/ws/proj-a/auth/${child.id}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('<aside class="content-sidebar">');
      expect(res.text).toContain("PARENTS");
      expect(res.text).toContain("Parent Idea");
    });

    it("renders type badges with per-type colors", async () => {
      const contents = db
        .prepare(
          `SELECT c.id, c.type FROM contents c
           JOIN features f ON c.feature_id = f.id
           JOIN workspaces w ON f.workspace_id = w.id
           WHERE w.name = 'proj-a' AND f.name = 'auth'`,
        )
        .all() as { id: number; type: string }[];
      const spec = contents.find((c) => c.type === "spec")!;

      const res = await request(app).get(`/ws/proj-a/auth/${spec.id}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain("#7c3aed");
    });

    it("does not show sidebar when content has no links", async () => {
      const solo = await createContent(db, "proj-a", "auth", "idea", "Solo idea body", "Solo Idea");
      const res = await request(app).get(`/ws/proj-a/auth/${solo.id}`);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain('<aside class="content-sidebar">');
    });

    it("renders page normally when getLineage throws", async () => {
      const result = await createContent(db, "proj-a", "auth", "idea", "Some idea", "Crash Test");
      db.prepare("DROP TABLE content_links").run();
      const res = await request(app).get(`/ws/proj-a/auth/${result.id}`);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain('<aside class="content-sidebar">');
    });
  });
});
