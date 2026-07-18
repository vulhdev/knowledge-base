import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { getContent } from "../../src/tools/get-content.js";
import { attachCodeRef } from "../../src/tools/attach-code-ref.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("getContent", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns the full content document by id", async () => {
    const created = await createContent(db, "proj", "auth", "spec", "spec body");
    const result = getContent(db, created.id);
    expect(result.id).toBe(created.id);
    expect(result.workspace).toBe("proj");
    expect(result.feature).toBe("auth");
    expect(result.type).toBe("spec");
    expect(result.body).toBe("spec body");
    expect(result.created_at).toBeTruthy();
    expect(result.updated_at).toBeTruthy();
  });

  it("returns title field (null when not set)", async () => {
    const created = await createContent(db, "proj", "auth", "idea", "body");
    const result = getContent(db, created.id);
    expect(result.title).toBeNull();
  });

  it("returns title when set on create", async () => {
    const created = await createContent(db, "proj", "auth", "doc", "body", "Feature Doc");
    const result = getContent(db, created.id);
    expect(result.title).toBe("Feature Doc");
  });

  it("throws a not-found error for a missing id", () => {
    expect(() => getContent(db, 999)).toThrow(/not found/i);
  });

  it("returns the correct document when multiple exist", async () => {
    const a = await createContent(db, "ws", "ft", "idea", "idea a");
    const b = await createContent(db, "ws", "ft", "plan", "plan b");
    expect(getContent(db, a.id).body).toBe("idea a");
    expect(getContent(db, b.id).body).toBe("plan b");
  });

  it("returns has_code_refs: false when no code refs exist", async () => {
    const created = await createContent(db, "ws", "ft", "plan", "plan body");
    const result = getContent(db, created.id);
    expect(result.has_code_refs).toBe(false);
  });

  it("returns has_code_refs: true after attaching a code ref", async () => {
    const created = await createContent(db, "ws", "ft", "plan", "plan body");
    attachCodeRef(db, created.id, "abc1234", [{ path: "src/foo.ts" }]);
    const result = getContent(db, created.id);
    expect(result.has_code_refs).toBe(true);
  });
});
