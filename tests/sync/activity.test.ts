import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { describeChangeset, makeConsoleLogger } from "../../src/sync/activity.js";
import type { ChangesetRow } from "../../src/sync/changeset.js";

// Minimal DB stub — returns a title for pk "1", nothing for others
function makeDb(titleMap: Record<string, string> = {}) {
  return {
    prepare: (sql: string) => ({
      get: (pk: string) => (titleMap[pk] ? { title: titleMap[pk] } : undefined),
    }),
  } as never;
}

const site = "aabbccdd11223344aabbccdd11223344";

function row(tbl: string, pk: string, cid: string, val: unknown = null): ChangesetRow {
  return { tbl, pk, cid, val, col_version: 1, db_version: 1, site_id: site };
}

describe("describeChangeset", () => {
  it("labels title change as 'edited title'", () => {
    const db = makeDb({ "1": "My Doc" });
    const result = describeChangeset([row("contents", "1", "title", "My Doc")], db);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('"My Doc"');
    expect(result[0].actions).toContain("edited title");
  });

  it("labels body change as 'edited body'", () => {
    const db = makeDb({ "1": "My Doc" });
    const result = describeChangeset([row("contents", "1", "body", "hello")], db);
    expect(result[0].actions).toContain("edited body");
  });

  it("labels __crsql_del as 'deleted doc'", () => {
    const db = makeDb();
    const result = describeChangeset([row("contents", "99", "__crsql_del", 1)], db);
    expect(result[0].actions).toContain("deleted doc");
  });

  it("labels unknown column as 'new doc'", () => {
    const db = makeDb();
    const result = describeChangeset([row("contents", "2", "source_key", "x")], db);
    expect(result[0].actions).toContain("new doc");
  });

  it("groups multiple cids for same pk into one entry", () => {
    const db = makeDb({ "1": "Doc" });
    const rows = [
      row("contents", "1", "title", "Doc"),
      row("contents", "1", "body", "text"),
    ];
    const result = describeChangeset(rows, db);
    expect(result).toHaveLength(1);
    expect(result[0].actions).toContain("edited title");
    expect(result[0].actions).toContain("edited body");
  });

  it("falls back to (id: pk) when title not in DB", () => {
    const db = makeDb();
    const result = describeChangeset([row("contents", "42", "title", "X")], db);
    expect(result[0].title).toBe("(id: 42)");
  });

  it("summarises content_features rows", () => {
    const db = makeDb();
    const result = describeChangeset([row("content_features", "1", "feature_id", 5)], db);
    expect(result[0].actions).toContain("feature changed");
  });

  it("summarises content_links rows", () => {
    const db = makeDb();
    const result = describeChangeset([row("content_links", "1", "target_id", 2)], db);
    expect(result[0].actions).toContain("link added/removed");
  });
});

describe("makeConsoleLogger", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { spy = vi.spyOn(console, "log").mockImplementation(() => {}); });
  afterEach(() => { spy.mockRestore(); });

  it("onPeerConnect logs @username", () => {
    makeConsoleLogger().onPeerConnect("ws", "alice", "abc123");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("@alice");
    expect(spy.mock.calls[0][0]).toContain("●");
  });

  it("onPeerConnect shows key prefix when username is null", () => {
    makeConsoleLogger().onPeerConnect("ws", null, "deadbeef1234");
    expect(spy.mock.calls[0][0]).toContain("deadbeef");
  });

  it("onPeerDisconnect logs ○", () => {
    makeConsoleLogger().onPeerDisconnect("ws", "bob", "abc");
    expect(spy.mock.calls[0][0]).toContain("○");
    expect(spy.mock.calls[0][0]).toContain("@bob");
  });

  it("onJoinAttempt logs ↑ and username", () => {
    makeConsoleLogger().onJoinAttempt("ws", "charlie");
    expect(spy.mock.calls[0][0]).toContain("↑");
    expect(spy.mock.calls[0][0]).toContain("@charlie");
  });

  it("onJoinResult accepted logs ✓", () => {
    makeConsoleLogger().onJoinResult("ws", "dave", true);
    expect(spy.mock.calls[0][0]).toContain("✓");
  });

  it("onJoinResult rejected logs ✗ and reason", () => {
    makeConsoleLogger().onJoinResult("ws", "eve", false, "not invited");
    expect(spy.mock.calls[0][0]).toContain("✗");
    expect(spy.mock.calls[0][0]).toContain("not invited");
  });

  it("onChangesetSent logs → and count", () => {
    makeConsoleLogger().onChangesetSent("ws", "frank", 7);
    expect(spy.mock.calls[0][0]).toContain("→");
    expect(spy.mock.calls[0][0]).toContain("7");
  });

  it("onChangesetReceived logs ← and prints doc actions", () => {
    const db = makeDb({ "1": "My Doc" });
    const rows = [row("contents", "1", "title", "My Doc")];
    makeConsoleLogger().onChangesetReceived("ws", "grace", rows, db);
    expect(spy.mock.calls[0][0]).toContain("←");
    expect(spy.mock.calls[1][0]).toContain("My Doc");
  });
});
