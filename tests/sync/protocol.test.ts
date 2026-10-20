import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { encodeChangeset, decodeChangeset, MAX_CHANGESET_BYTES, type ChangesetRow } from "../../src/sync/changeset.js";

// Simulate the framing protocol used in handleSyncConnection:
// Line 1 (newline-terminated): JSON handshake { v, dbVersion }
// Then: 4-byte big-endian length prefix + raw changeset JSON

function buildSyncMessage(dbVersion: number, rows: ChangesetRow[]): Buffer {
  const handshake = JSON.stringify({ v: 1, dbVersion }) + "\n";
  const payload = encodeChangeset(rows);
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([Buffer.from(handshake), header, payload]);
}

function parseSyncMessage(data: Buffer): {
  dbVersion: number;
  rows: ChangesetRow[];
} {
  const newline = data.indexOf(0x0a);
  const handshake = JSON.parse(data.slice(0, newline).toString()) as { v: number; dbVersion: number };
  const rest = data.slice(newline + 1);
  const size = rest.readUInt32BE(0);
  const payload = rest.slice(4, 4 + size);
  return { dbVersion: handshake.dbVersion, rows: decodeChangeset(payload) };
}

describe("sync protocol framing", () => {
  it("encodes and decodes a handshake with empty changeset", () => {
    const msg = buildSyncMessage(0, []);
    const { dbVersion, rows } = parseSyncMessage(msg);
    expect(dbVersion).toBe(0);
    expect(rows).toEqual([]);
  });

  it("round-trips changeset rows through the framing protocol", () => {
    const rows: ChangesetRow[] = [
      {
        tbl: "contents",
        pk: "0100000000000000",
        cid: "body",
        val: "Hello from peer A",
        col_version: 1,
        db_version: 7,
        site_id: "aabbccdd11223344aabbccdd11223344",
      },
      {
        tbl: "contents",
        pk: "0100000000000000",
        cid: "type",
        val: "idea",
        col_version: 1,
        db_version: 7,
        site_id: "aabbccdd11223344aabbccdd11223344",
      },
    ];
    const msg = buildSyncMessage(5, rows);
    const parsed = parseSyncMessage(msg);
    expect(parsed.dbVersion).toBe(5);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].val).toBe("Hello from peer A");
    expect(parsed.rows[1].cid).toBe("type");
  });

  it("PassThrough stream can carry framed changeset messages", async () => {
    const stream = new PassThrough();
    const rows: ChangesetRow[] = [
      {
        tbl: "workspaces",
        pk: "0100000000000000",
        cid: "name",
        val: "my-project",
        col_version: 1,
        db_version: 3,
        site_id: "ccddee1122334455ccddee1122334455",
      },
    ];
    const msg = buildSyncMessage(2, rows);
    stream.write(msg);
    stream.end();

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    const received = Buffer.concat(chunks);
    const parsed = parseSyncMessage(received);
    expect(parsed.dbVersion).toBe(2);
    expect(parsed.rows[0].tbl).toBe("workspaces");
  });

  it("rejects changeset exceeding the size cap", () => {
    const oversized = Buffer.alloc(MAX_CHANGESET_BYTES + 1);
    expect(() => decodeChangeset(oversized)).toThrow(/too large/i);
  });
});
