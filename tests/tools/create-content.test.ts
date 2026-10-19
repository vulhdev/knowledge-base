import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("createContent", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("creates a document and returns id + metadata", async () => {
    const result = await createContent(db, "my-project", ["auth"], "idea", "some idea");
    expect(result.id).toBeTypeOf("number");
    expect(result.workspace).toBe("my-project");
    expect(result.features).toEqual(["auth"]);
    expect(result.type).toBe("idea");
    expect(result.created_at).toBeTruthy();
  });

  it("creates a document in multiple features", async () => {
    const result = await createContent(db, "proj", ["beta", "alpha"], "spec", "cross-cutting spec");
    expect(result.features).toEqual(["alpha", "beta"]);
    const rows = db.prepare("SELECT COUNT(*) AS n FROM content_features WHERE content_id = ?").get(result.id) as { n: number };
    expect(rows.n).toBe(2);
  });

  it("throws for empty features array", async () => {
    await expect(createContent(db, "ws", [], "idea", "body")).rejects.toThrow(/features must not be empty/);
  });

  it("auto-creates workspace and feature if they don't exist", async () => {
    await createContent(db, "new-ws", ["new-ft"], "spec", "spec body");
    expect(db.prepare("SELECT id FROM workspaces WHERE name = ?").get("new-ws")).toBeTruthy();
    expect(db.prepare("SELECT id FROM features WHERE name = ?").get("new-ft")).toBeTruthy();
  });

  it("reuses existing workspace and feature", async () => {
    await createContent(db, "ws", ["ft"], "idea", "first");
    await createContent(db, "ws", ["ft"], "idea", "second");
    const workspaces = db.prepare("SELECT id FROM workspaces WHERE name = ?").all("ws");
    expect(workspaces).toHaveLength(1);
    const features = db.prepare("SELECT id FROM features WHERE name = ?").all("ft");
    expect(features).toHaveLength(1);
  });

  it("accepts any non-empty string as type", async () => {
    const result = await createContent(db, "ws", ["ft"], "issue" as any, "body");
    expect(result.type).toBe("issue");
  });

  it("accepts custom type adr", async () => {
    const result = await createContent(db, "ws", ["ft"], "adr" as any, "body");
    expect(result.type).toBe("adr");
  });

  it("throws for empty body", async () => {
    await expect(createContent(db, "ws", ["ft"], "idea", "")).rejects.toThrow(/body must not be empty/);
    await expect(createContent(db, "ws", ["ft"], "idea", "   ")).rejects.toThrow(/body must not be empty/);
  });

  it("FTS index contains the new body after insert", async () => {
    await createContent(db, "ws", ["ft"], "idea", "unique keyword xyzzy");
    const rows = db.prepare("SELECT rowid FROM contents_fts WHERE contents_fts MATCH ?").all("xyzzy");
    expect(rows).toHaveLength(1);
  });

  it("supports all valid content types", async () => {
    for (const type of ["idea", "spec", "plan", "digest", "doc"] as const) {
      const r = await createContent(db, "ws", [type], type, `body for ${type}`);
      expect(r.type).toBe(type);
    }
  });

  it("returns title when provided", async () => {
    const result = await createContent(db, "ws", ["ft"], "doc", "body text", "My Doc Title");
    expect(result.title).toBe("My Doc Title");
  });

  it("returns null title when not provided", async () => {
    const result = await createContent(db, "ws", ["ft"], "idea", "body text");
    expect(result.title).toBeNull();
  });

  it("throws a descriptive error when creating a second digest for the same feature", async () => {
    await createContent(db, "ws", ["ft"], "digest", "first digest body");
    await expect(createContent(db, "ws", ["ft"], "digest", "second digest body")).rejects.toThrow(
      /digest already exists for feature/i,
    );
  });

  it("allows digest in different features independently", async () => {
    await createContent(db, "ws", ["feat-a"], "digest", "digest for a");
    await expect(createContent(db, "ws", ["feat-b"], "digest", "digest for b")).resolves.toBeTruthy();
  });

  it("allows multiple doc rows in the same feature", async () => {
    await createContent(db, "ws", ["ft"], "doc", "db schema doc", "DB Schema");
    await createContent(db, "ws", ["ft"], "doc", "backend flow doc", "Backend Flow");
    const rows = db.prepare("SELECT id FROM contents WHERE type = 'doc'").all();
    expect(rows).toHaveLength(2);
  });

  it("stores embedding when model is ready", async () => {
    const { isModelReady, getEmbedding } = await import("../../src/embedding/model.js");
    vi.mocked(isModelReady).mockReturnValue(true);
    vi.mocked(getEmbedding).mockResolvedValue(new Float32Array(384).fill(0.5));

    const result = await createContent(db, "ws", ["ft"], "idea", "test body");
    const row = db.prepare("SELECT embedding FROM contents WHERE id = ?").get(result.id) as { embedding: Buffer | null };
    expect(row.embedding).not.toBeNull();

    vi.mocked(isModelReady).mockReturnValue(false);
  });

  it("returns conflicts: [] when requestSampling is not provided", async () => {
    const result = await createContent(db, "ws", ["ft"], "spec", "some spec");
    expect(result.conflicts).toEqual([]);
  });

  it("returns conflicts: [] when embedding not ready (no similar docs to compare)", async () => {
    const requestSampling = vi.fn();
    const result = await createContent(db, "ws", ["ft"], "spec", "some spec", undefined, requestSampling);
    expect(result.conflicts).toEqual([]);
    expect(requestSampling).not.toHaveBeenCalled();
  });

  it("returns conflicts when sampling detects one", async () => {
    const { isModelReady, getEmbedding } = await import("../../src/embedding/model.js");
    vi.mocked(isModelReady).mockReturnValue(true);
    vi.mocked(getEmbedding).mockResolvedValue(new Float32Array(384).fill(0));

    const first = await createContent(db, "ws", ["ft"], "spec", "use REST API");
    const conflictResponse = JSON.stringify([
      { content_id: first.id, features: ["ft"], type: "semantic_contradiction", reason: "REST vs GraphQL" },
    ]);
    const requestSampling = vi.fn().mockResolvedValue(conflictResponse);

    const result = await createContent(db, "ws", ["ft2"], "spec", "use GraphQL API", undefined, requestSampling);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].content_id).toBe(first.id);
    expect(result.conflicts[0].type).toBe("semantic_contradiction");

    vi.mocked(isModelReady).mockReturnValue(false);
  });

  it("returns conflicts: [] when requestSampling throws", async () => {
    const { isModelReady, getEmbedding } = await import("../../src/embedding/model.js");
    vi.mocked(isModelReady).mockReturnValue(true);
    vi.mocked(getEmbedding).mockResolvedValue(new Float32Array(384).fill(0));

    await createContent(db, "ws", ["ft"], "spec", "existing doc");
    const requestSampling = vi.fn().mockRejectedValue(new Error("host unavailable"));

    const result = await createContent(db, "ws", ["ft2"], "spec", "new doc", undefined, requestSampling);
    expect(result.conflicts).toEqual([]);

    vi.mocked(isModelReady).mockReturnValue(false);
  });

  it("always returns suggested_parents as an array", async () => {
    const result = await createContent(db, "ws", ["ft"], "spec", "some spec body");
    expect(Array.isArray(result.suggested_parents)).toBe(true);
  });

  it("suggested_parents for type=idea never includes later seed types (spec, plan)", async () => {
    await createContent(db, "ws", ["ft"], "spec", "checkout redesign spec");
    await createContent(db, "ws", ["ft"], "plan", "checkout redesign plan");
    const result = await createContent(db, "ws", ["ft"], "idea", "checkout redesign idea");
    expect(result.suggested_parents).toEqual([]);
  });

  it("suggested_parents works for custom types", async () => {
    await createContent(db, "ws", ["ft"], "requirement", "invoice export requirement");
    const result = await createContent(db, "ws", ["ft"], "analyze", "invoice export analyze");
    expect(result.suggested_parents.map((p) => p.type)).toEqual(["requirement"]);
  });

  it("suggested_parents never includes the document itself or its own type", async () => {
    await createContent(db, "ws", ["ft"], "adr", "billing retry adr one");
    const result = await createContent(db, "ws", ["ft"], "adr", "billing retry adr two");
    expect(result.suggested_parents).toEqual([]);
  });

  it("suggested_parents excludes types that existing links place after the new type", async () => {
    const req = await createContent(db, "ws", ["ft"], "requirement", "ledger sync requirement");
    const ana = await createContent(db, "ws", ["ft"], "analyze", "ledger sync analyze");
    db.prepare("INSERT INTO content_links (parent_id, child_id) VALUES (?, ?)").run(req.id, ana.id);

    const result = await createContent(db, "ws", ["ft"], "requirement", "ledger sync requirement v2");
    expect(result.suggested_parents.map((p) => p.type)).not.toContain("analyze");
  });

  it("FTS fallback: suggests ideas when creating spec and model is not ready", async () => {
    await createContent(db, "ws", ["ft"], "idea", "payment flow redesign proposal");
    const result = await createContent(db, "ws", ["ft"], "spec", "payment flow redesign spec");
    expect(result.suggested_parents.length).toBeGreaterThan(0);
    expect(result.suggested_parents[0].type).toBe("idea");
    expect(typeof result.suggested_parents[0].id).toBe("number");
    expect(typeof result.suggested_parents[0].score).toBe("number");
  });

  it("FTS fallback: suggests specs when creating plan and model is not ready", async () => {
    await createContent(db, "ws", ["ft"], "spec", "authentication redesign spec");
    const result = await createContent(db, "ws", ["ft"], "plan", "authentication redesign plan");
    expect(result.suggested_parents.length).toBeGreaterThan(0);
    expect(result.suggested_parents[0].type).toBe("spec");
  });

  it("FTS fallback: does not suggest content from a different workspace", async () => {
    await createContent(db, "other-ws", ["ft"], "idea", "payment flow redesign idea");
    const result = await createContent(db, "ws", ["ft"], "spec", "payment flow redesign spec");
    for (const suggestion of result.suggested_parents) {
      const row = db
        .prepare(
          `SELECT w.name AS ws FROM contents c
           JOIN content_features cf ON cf.content_id = c.id
           JOIN features f ON cf.feature_id = f.id
           JOIN workspaces w ON f.workspace_id = w.id
           WHERE c.id = ?`,
        )
        .get(suggestion.id) as { ws: string };
      expect(row.ws).toBe("ws");
    }
  });

  it("FTS fallback of suggested_parents finds a doc sharing a Japanese term (CJK is no longer stripped)", async () => {
    const parent = await createContent(db, "ws-jp", ["ft"], "idea", "見積金額は原価に掛率を乗じて算出する。");
    const child = await createContent(db, "ws-jp", ["ft"], "spec", "掛率 の 決め方");
    expect(child.suggested_parents.map((p) => p.id)).toContain(parent.id);
  });
});
