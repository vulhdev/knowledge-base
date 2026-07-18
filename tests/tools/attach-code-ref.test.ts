import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { attachCodeRef } from "../../src/tools/attach-code-ref.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("attachCodeRef", () => {
  let db: Database.Database;
  let contentId: number;

  beforeEach(async () => {
    db = createTestDb();
    const c = await createContent(db, "ws", "feat", "plan", "plan body");
    contentId = c.id;
  });

  it("inserts a row and returns correct shape", () => {
    const result = attachCodeRef(db, contentId, "abc1234", [{ path: "src/foo.ts" }], "Task 1");
    expect(result.id).toBeTypeOf("number");
    expect(result.content_id).toBe(contentId);
    expect(result.commit_hash).toBe("abc1234");
    expect(result.task_ref).toBe("Task 1");
    expect(result.file_paths).toEqual([{ path: "src/foo.ts" }]);
    expect(result.created_at).toBeTruthy();
  });

  it("throws on unknown content_id", () => {
    expect(() => attachCodeRef(db, 999, "abc1234", [{ path: "src/foo.ts" }])).toThrow(
      /Content not found: id=999/,
    );
  });

  it("inserts row with task_ref null when omitted", () => {
    const result = attachCodeRef(db, contentId, "abc1234", [{ path: "src/foo.ts" }]);
    expect(result.task_ref).toBeNull();
  });

  it("allows multiple refs for same content with different commits", () => {
    attachCodeRef(db, contentId, "aaa0001", [{ path: "src/a.ts" }], "Task 1");
    const result = attachCodeRef(db, contentId, "bbb0002", [{ path: "src/b.ts" }], "Task 2");
    expect(result.commit_hash).toBe("bbb0002");
  });

  it("throws on duplicate (content_id, commit_hash)", () => {
    attachCodeRef(db, contentId, "abc1234", [{ path: "src/foo.ts" }]);
    expect(() => attachCodeRef(db, contentId, "abc1234", [{ path: "src/bar.ts" }])).toThrow();
  });

  it("round-trips file_paths including optional start/end", () => {
    const files = [
      { path: "src/auth.ts", start: 42, end: 89 },
      { path: "tests/auth.test.ts" },
    ];
    const result = attachCodeRef(db, contentId, "abc1234", files, "Task 1");
    expect(result.file_paths).toEqual(files);
  });

  it("cascades delete — removing content removes its refs", async () => {
    attachCodeRef(db, contentId, "abc1234", [{ path: "src/foo.ts" }]);
    db.prepare("DELETE FROM contents WHERE id = ?").run(contentId);
    const rows = db.prepare("SELECT * FROM code_refs WHERE content_id = ?").all(contentId);
    expect(rows).toHaveLength(0);
  });
});
