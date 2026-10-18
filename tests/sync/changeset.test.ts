import { describe, it, expect } from "vitest";

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
