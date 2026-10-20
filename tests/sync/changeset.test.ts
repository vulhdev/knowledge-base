import { describe, it, expect } from "vitest";
import type Database from "better-sqlite3";

const SAMPLE_ROWS = [
  {
    tbl: "contents",
    pk: "0100000000000000",
    cid: "title",
    val: "Hello world",
    col_version: 1,
    db_version: 5,
    site_id: "aabbccdd11223344aabbccdd11223344",
  },
];

describe("getChanges", () => {
  it("queries all changes since sinceVersion without site_id filter", async () => {
    const { getChanges } = await import("../../src/sync/changeset.js");
    let capturedSql = "";
    const mockDb = {
      prepare: (sql: string) => { capturedSql = sql; return { all: () => [] }; },
    } as unknown as Database.Database;

    getChanges(mockDb, 42);

    expect(capturedSql).toContain("db_version > ?");
    expect(capturedSql).not.toContain("site_id !=");
  });
});

describe("encodeChangeset / decodeChangeset", () => {
  it("round-trips a changeset through encode then decode", async () => {
    const { encodeChangeset, decodeChangeset } = await import("../../src/sync/changeset.js");
    const buf = encodeChangeset(SAMPLE_ROWS);
    const out = decodeChangeset(buf);
    expect(out).toEqual(SAMPLE_ROWS);
  });

  it("encodeChangeset returns a Buffer", async () => {
    const { encodeChangeset } = await import("../../src/sync/changeset.js");
    expect(encodeChangeset(SAMPLE_ROWS)).toBeInstanceOf(Buffer);
  });

  it("encodeChangeset returns empty Buffer for empty array", async () => {
    const { encodeChangeset, decodeChangeset } = await import("../../src/sync/changeset.js");
    expect(decodeChangeset(encodeChangeset([]))).toEqual([]);
  });

  it("decodeChangeset throws when data exceeds MAX_CHANGESET_BYTES", async () => {
    const { decodeChangeset, MAX_CHANGESET_BYTES } = await import("../../src/sync/changeset.js");
    const oversized = Buffer.alloc(MAX_CHANGESET_BYTES + 1);
    expect(() => decodeChangeset(oversized)).toThrow(/too large/i);
  });

  it("decodeChangeset throws on non-array JSON", async () => {
    const { decodeChangeset } = await import("../../src/sync/changeset.js");
    expect(() => decodeChangeset(Buffer.from(JSON.stringify({ not: "array" })))).toThrow(
      /invalid changeset/i,
    );
  });

  it("decodeChangeset throws on invalid JSON", async () => {
    const { decodeChangeset } = await import("../../src/sync/changeset.js");
    expect(() => decodeChangeset(Buffer.from("not json"))).toThrow();
  });
});

describe("applyChanges", () => {
  it("SEC-2: throws when changeset targets a non-CRDT table", async () => {
    const { applyChanges } = await import("../../src/sync/changeset.js");
    const maliciousRows = [{
      tbl: "team_peers",
      pk: "0100000000000000",
      cid: "is_active",
      val: 1,
      col_version: 1,
      db_version: 1,
      site_id: "aa",
    }];
    const mockDb = {} as unknown as Database.Database;
    expect(() => applyChanges(mockDb, maliciousRows)).toThrow(/non-CRDT table/i);
  });

  it("SEC-2: throws for any unlisted table name", async () => {
    const { applyChanges } = await import("../../src/sync/changeset.js");
    const rows = [{
      tbl: "error_logs",
      pk: "01",
      cid: "message",
      val: "injected",
      col_version: 1,
      db_version: 1,
      site_id: "aa",
    }];
    expect(() => applyChanges({} as unknown as Database.Database, rows)).toThrow(/non-CRDT table/i);
  });

  it("throws when row count exceeds MAX_CHANGESET_ROWS", async () => {
    const { applyChanges, MAX_CHANGESET_ROWS } = await import("../../src/sync/changeset.js");
    const rows = Array.from({ length: MAX_CHANGESET_ROWS + 1 }, () => ({
      tbl: "contents", pk: "01", cid: "title", val: "x",
      col_version: 1, db_version: 1, site_id: "aa",
    }));
    expect(() => applyChanges({} as unknown as Database.Database, rows)).toThrow(/too many rows/i);
  });

  it("SEC-2: CRDT_TABLES export contains the five registered tables", async () => {
    const { CRDT_TABLES } = await import("../../src/sync/changeset.js");
    expect(CRDT_TABLES.has("workspaces")).toBe(true);
    expect(CRDT_TABLES.has("features")).toBe(true);
    expect(CRDT_TABLES.has("contents")).toBe(true);
    expect(CRDT_TABLES.has("content_features")).toBe(true);
    expect(CRDT_TABLES.has("content_links")).toBe(true);
    expect(CRDT_TABLES.has("team_peers")).toBe(false);
  });
});
