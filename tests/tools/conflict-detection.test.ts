import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import {
  findSimilarInWorkspace,
  buildPrompt,
  parseConflicts,
  detectConflicts,
} from "../../src/tools/conflict-detection.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

const DUMMY_EMBEDDING = Buffer.from(new Float32Array(384).fill(0).buffer);

function insertDocWithEmbedding(
  db: Database.Database,
  workspace: string,
  feature: string,
  type: string,
  body: string,
  embedding: Buffer,
): number {
  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(workspace);
  const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(workspace) as { id: number };
  db.prepare("INSERT OR IGNORE INTO features (workspace_id, name) VALUES (?, ?)").run(ws.id, feature);
  const ft = db.prepare("SELECT id FROM features WHERE workspace_id = ? AND name = ?").get(ws.id, feature) as { id: number };
  const { lastInsertRowid } = db
    .prepare("INSERT INTO contents (feature_id, type, body) VALUES (?, ?, ?)")
    .run(ft.id, type, body);
  const id = Number(lastInsertRowid);
  db.prepare("UPDATE contents SET embedding = ? WHERE id = ?").run(embedding, id);
  return id;
}

describe("findSimilarInWorkspace", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns empty array when no docs exist", () => {
    const result = findSimilarInWorkspace(db, 999, "ws", DUMMY_EMBEDDING);
    expect(result).toEqual([]);
  });

  it("excludes the content itself", () => {
    const id = insertDocWithEmbedding(db, "ws", "ft", "spec", "same doc", DUMMY_EMBEDDING);
    const result = findSimilarInWorkspace(db, id, "ws", DUMMY_EMBEDDING);
    expect(result.every((r) => r.id !== id)).toBe(true);
  });

  it("excludes docs from other workspaces", () => {
    const id1 = insertDocWithEmbedding(db, "ws-a", "ft", "spec", "doc a", DUMMY_EMBEDDING);
    insertDocWithEmbedding(db, "ws-b", "ft", "spec", "doc b", DUMMY_EMBEDDING);
    const result = findSimilarInWorkspace(db, id1, "ws-a", DUMMY_EMBEDDING);
    expect(result.every((r) => r.id !== id1)).toBe(true);
  });
});

describe("buildPrompt", () => {
  it("includes new doc and all candidates", () => {
    const prompt = buildPrompt("proj", "api", "spec", "new body", [
      { id: 1, feature: "auth", type: "spec", body: "old body" },
    ]);
    expect(prompt).toContain("new body");
    expect(prompt).toContain("old body");
    expect(prompt).toContain('id=1, feature="auth"');
    expect(prompt).toContain("semantic_contradiction");
    expect(prompt).toContain("risk_shadow");
  });
});

describe("parseConflicts", () => {
  const candidates = [
    { id: 17, feature: "auth", type: "spec", body: "..." },
    { id: 23, feature: "transport", type: "plan", body: "..." },
  ];

  it("parses valid JSON array", () => {
    const raw = JSON.stringify([
      { content_id: 17, feature: "auth", type: "semantic_contradiction", reason: "REST vs GraphQL" },
    ]);
    const result = parseConflicts(raw, candidates);
    expect(result).toHaveLength(1);
    expect(result[0].content_id).toBe(17);
    expect(result[0].type).toBe("semantic_contradiction");
  });

  it("extracts JSON from surrounding text", () => {
    const raw = `Here are the conflicts:\n[\n  { "content_id": 23, "feature": "transport", "type": "risk_shadow", "reason": "risk mentioned" }\n]\nEnd.`;
    const result = parseConflicts(raw, candidates);
    expect(result).toHaveLength(1);
    expect(result[0].content_id).toBe(23);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseConflicts("not json at all", candidates)).toEqual([]);
    expect(parseConflicts("[invalid}", candidates)).toEqual([]);
  });

  it("filters out content_id not in candidates", () => {
    const raw = JSON.stringify([
      { content_id: 999, feature: "other", type: "semantic_contradiction", reason: "..." },
    ]);
    expect(parseConflicts(raw, candidates)).toEqual([]);
  });

  it("filters out invalid conflict type", () => {
    const raw = JSON.stringify([
      { content_id: 17, feature: "auth", type: "made_up_type", reason: "..." },
    ]);
    expect(parseConflicts(raw, candidates)).toEqual([]);
  });

  it("returns empty array when Claude returns empty array", () => {
    expect(parseConflicts("[]", candidates)).toEqual([]);
  });
});

describe("detectConflicts", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns empty array when no similar docs", async () => {
    const requestSampling = vi.fn();
    const result = await detectConflicts(db, 1, "ws", "ft", "spec", "body", DUMMY_EMBEDDING, requestSampling);
    expect(result).toEqual([]);
    expect(requestSampling).not.toHaveBeenCalled();
  });

  it("returns conflicts when sampling succeeds", async () => {
    const id1 = insertDocWithEmbedding(db, "ws", "ft", "spec", "old doc", DUMMY_EMBEDDING);
    const id2 = insertDocWithEmbedding(db, "ws", "ft2", "spec", "new doc", DUMMY_EMBEDDING);

    const requestSampling = vi.fn().mockResolvedValue(
      JSON.stringify([{ content_id: id1, feature: "ft", type: "semantic_contradiction", reason: "they conflict" }]),
    );

    const result = await detectConflicts(db, id2, "ws", "ft2", "spec", "new doc", DUMMY_EMBEDDING, requestSampling);
    expect(result).toHaveLength(1);
    expect(result[0].content_id).toBe(id1);
    expect(requestSampling).toHaveBeenCalledOnce();
  });

  it("returns empty array when sampling throws", async () => {
    insertDocWithEmbedding(db, "ws", "ft", "spec", "existing", DUMMY_EMBEDDING);
    const id2 = insertDocWithEmbedding(db, "ws", "ft2", "spec", "new", DUMMY_EMBEDDING);

    const requestSampling = vi.fn().mockRejectedValue(new Error("sampling failed"));
    const result = await detectConflicts(db, id2, "ws", "ft2", "spec", "new", DUMMY_EMBEDDING, requestSampling);
    expect(result).toEqual([]);
  });
});
