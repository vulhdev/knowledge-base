import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { createContent } from "../../src/tools/create-content.js";
import { attachCodeRef } from "../../src/tools/attach-code-ref.js";
import { getCodeRefs } from "../../src/tools/get-code-refs.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0)),
}));

describe("getCodeRefs", () => {
  let db: Database.Database;
  let contentId: number;

  beforeEach(async () => {
    db = createTestDb();
    const c = await createContent(db, "ws", "feat", "plan", "plan body");
    contentId = c.id;
  });

  it("returns empty refs for content with no code refs", () => {
    const result = getCodeRefs(db, contentId);
    expect(result.content_id).toBe(contentId);
    expect(result.refs).toEqual([]);
  });

  it("returns refs ordered by created_at ascending", () => {
    attachCodeRef(db, contentId, "aaa0001", [{ path: "src/a.ts" }], "Task 1");
    attachCodeRef(db, contentId, "bbb0002", [{ path: "src/b.ts" }], "Task 2");
    const result = getCodeRefs(db, contentId);
    expect(result.refs).toHaveLength(2);
    expect(result.refs[0].commit_hash).toBe("aaa0001");
    expect(result.refs[1].commit_hash).toBe("bbb0002");
  });

  it("parses file_paths from JSON string into CodeRefFile[]", () => {
    const files = [{ path: "src/auth.ts", start: 10, end: 50 }, { path: "tests/auth.test.ts" }];
    attachCodeRef(db, contentId, "abc1234", files, "Task 1");
    const result = getCodeRefs(db, contentId);
    expect(result.refs[0].file_paths).toEqual(files);
  });

  it("returns correct shape for each ref", () => {
    attachCodeRef(db, contentId, "abc1234", [{ path: "src/foo.ts" }], "Task 1");
    const ref = getCodeRefs(db, contentId).refs[0];
    expect(ref).toMatchObject({
      content_id: contentId,
      commit_hash: "abc1234",
      task_ref: "Task 1",
    });
    expect(ref.id).toBeTypeOf("number");
    expect(ref.created_at).toBeTruthy();
  });

  it("does not throw for content with no refs — returns empty array", () => {
    expect(() => getCodeRefs(db, contentId)).not.toThrow();
  });
});
