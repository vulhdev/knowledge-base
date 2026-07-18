import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { deriveContent } from "../../src/tools/derive-content.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

function seed(db: Database.Database, workspace: string, feature: string): number {
  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(workspace);
  const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(workspace) as { id: number };
  db.prepare("INSERT OR IGNORE INTO features (workspace_id, name) VALUES (?, ?)").run(ws.id, feature);
  const ft = db.prepare("SELECT id FROM features WHERE workspace_id = ? AND name = ?").get(ws.id, feature) as { id: number };
  return ft.id;
}

function insertContent(db: Database.Database, featureId: number, type: string, body: string): number {
  const { lastInsertRowid } = db.prepare("INSERT INTO contents (feature_id, type, body) VALUES (?, ?, ?)").run(featureId, type, body);
  return Number(lastInsertRowid);
}

describe("deriveContent", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("throws Content not found when parent ID does not exist", async () => {
    await expect(deriveContent(db, 99999, "spec", "body")).rejects.toThrow(/Content not found: id=99999/);
  });

  it("creates child content in parent's workspace and feature", async () => {
    const ftId = seed(db, "my-ws", "my-ft");
    const parentId = insertContent(db, ftId, "idea", "parent idea");

    const result = await deriveContent(db, parentId, "spec", "derived spec body");

    expect(result.workspace).toBe("my-ws");
    expect(result.feature).toBe("my-ft");
    expect(result.type).toBe("spec");
  });

  it("creates a link row between parent and child", async () => {
    const ftId = seed(db, "ws", "ft");
    const parentId = insertContent(db, ftId, "idea", "parent");

    const result = await deriveContent(db, parentId, "spec", "child spec");

    const link = db
      .prepare("SELECT * FROM content_links WHERE parent_id = ? AND child_id = ?")
      .get(parentId, result.id);
    expect(link).toBeTruthy();
  });

  it("returns parent_id in result", async () => {
    const ftId = seed(db, "ws", "ft");
    const parentId = insertContent(db, ftId, "idea", "parent");

    const result = await deriveContent(db, parentId, "spec", "child");

    expect(result.parent_id).toBe(parentId);
  });

  it("accepts optional title", async () => {
    const ftId = seed(db, "ws", "ft");
    const parentId = insertContent(db, ftId, "idea", "parent");

    const result = await deriveContent(db, parentId, "spec", "body", "My Spec Title");

    expect(result.title).toBe("My Spec Title");
  });

  it("result includes suggested_parents array", async () => {
    const ftId = seed(db, "ws", "ft");
    const parentId = insertContent(db, ftId, "idea", "parent");

    const result = await deriveContent(db, parentId, "spec", "body");

    expect(Array.isArray(result.suggested_parents)).toBe(true);
  });

  it("result includes id and created_at", async () => {
    const ftId = seed(db, "ws", "ft");
    const parentId = insertContent(db, ftId, "idea", "parent");

    const result = await deriveContent(db, parentId, "spec", "body");

    expect(result.id).toBeTypeOf("number");
    expect(result.created_at).toBeTruthy();
  });
});
