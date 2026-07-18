import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { insertErrorLog, listErrorLogs } from "../../src/db/error-log.js";

describe("error-log", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("creates error_logs table via applySchema", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='error_logs'")
      .get();
    expect(row).toBeTruthy();
  });

  it("inserts an error and lists it back", () => {
    insertErrorLog(db, "get_content", "not found");
    const logs = listErrorLogs(db);
    expect(logs).toHaveLength(1);
    expect(logs[0].tool_name).toBe("get_content");
    expect(logs[0].message).toBe("not found");
    expect(logs[0].severity).toBe("error");
    expect(logs[0].timestamp).toBeTruthy();
  });

  it("lists entries in reverse-insert order (newest first)", () => {
    insertErrorLog(db, "tool_a", "first");
    insertErrorLog(db, "tool_b", "second");
    const logs = listErrorLogs(db);
    expect(logs[0].tool_name).toBe("tool_b");
    expect(logs[1].tool_name).toBe("tool_a");
  });

  it("prunes to 1000 entries after inserting 1001", () => {
    for (let i = 0; i < 1001; i++) {
      db.prepare("INSERT INTO error_logs (tool_name, message) VALUES (?, ?)").run(`tool_${i}`, `msg_${i}`);
    }
    // call prune indirectly via one more insert
    insertErrorLog(db, "trigger_prune", "prune me");
    const logs = listErrorLogs(db);
    expect(logs.length).toBe(1000);
    // newest is the trigger_prune entry
    expect(logs[0].tool_name).toBe("trigger_prune");
  });

  it("falls back to console.error and does not throw when DB is closed", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.close();
    expect(() => insertErrorLog(db, "some_tool", "boom")).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
