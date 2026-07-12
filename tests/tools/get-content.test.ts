import { describe, it, expect, beforeEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { getContent } from "../../src/tools/get-content.js";

describe("getContent", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns the full content document by id", () => {
    const created = createContent(db, "proj", "auth", "spec", "spec body");
    const result = getContent(db, created.id);
    expect(result.id).toBe(created.id);
    expect(result.workspace).toBe("proj");
    expect(result.feature).toBe("auth");
    expect(result.type).toBe("spec");
    expect(result.body).toBe("spec body");
    expect(result.created_at).toBeTruthy();
    expect(result.updated_at).toBeTruthy();
  });

  it("throws a not-found error for a missing id", () => {
    expect(() => getContent(db, 999)).toThrow(/not found/i);
  });

  it("returns the correct document when multiple exist", () => {
    const a = createContent(db, "ws", "ft", "idea", "idea a");
    const b = createContent(db, "ws", "ft", "plan", "plan b");
    expect(getContent(db, a.id).body).toBe("idea a");
    expect(getContent(db, b.id).body).toBe("plan b");
  });
});
