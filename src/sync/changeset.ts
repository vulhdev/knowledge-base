import type Database from "better-sqlite3";

export type ChangesetRow = {
  tbl: string;
  pk: string;
  cid: string;
  val: unknown;
  col_version: number;
  db_version: number;
  site_id: string;
  cl: number;
  seq: number;
};

export const MAX_CHANGESET_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_CHANGESET_ROWS = 10_000;

export const CRDT_TABLES = new Set([
  "workspaces",
  "features",
  "contents",
  "content_features",
  "content_links",
]);

export function encodeChangeset(rows: ChangesetRow[]): Buffer {
  return Buffer.from(JSON.stringify(rows), "utf8");
}

export function decodeChangeset(data: Buffer): ChangesetRow[] {
  if (data.length > MAX_CHANGESET_BYTES) {
    throw new Error(`Changeset too large: ${data.length} bytes (max ${MAX_CHANGESET_BYTES})`);
  }
  const parsed: unknown = JSON.parse(data.toString("utf8"));
  if (!Array.isArray(parsed)) throw new Error("Invalid changeset: expected array");
  return parsed as ChangesetRow[];
}

export function getChanges(db: Database.Database, sinceVersion: number): ChangesetRow[] {
  return db
    .prepare(
      'SELECT "table" AS tbl, pk, cid, val, col_version, db_version, site_id, cl, seq ' +
      "FROM crsql_changes WHERE db_version > ?",
    )
    .all(sinceVersion) as ChangesetRow[];
}

// CRDT pk values are binary-encoded strings; when transported over JSON they may arrive
// as Buffer-like objects ({type:"Buffer",data:[...]}) or as hex/binary strings up to ~256 bytes.
const MAX_PK_SERIALIZED_LEN = 4096; // generous cap against flooding attacks

// crsql stores pk and site_id as BLOBs. After JSON round-trip (encodeChangeset →
// decodeChangeset), Buffers become plain objects: {type:"Buffer",data:[...]}.
// better-sqlite3 treats plain objects as named-parameter maps and throws. Convert back
// to Buffer before inserting so the CRDT merge can read the binary-encoded primary key.
function toBlob(val: unknown): Buffer {
  if (Buffer.isBuffer(val)) return val;
  if (
    typeof val === "object" &&
    val !== null &&
    (val as { type?: unknown }).type === "Buffer" &&
    Array.isArray((val as { data?: unknown }).data)
  ) {
    return Buffer.from((val as { data: number[] }).data);
  }
  return Buffer.from(String(val), "utf8");
}

// val can hold any column value (string, number, null, or BLOB). Unlike pk/site_id,
// strings and numbers must pass through unchanged — only Buffer-like objects from the
// JSON round-trip need to be converted back to a real Buffer so better-sqlite3 can
// bind them as blobs (e.g. contents.embedding).
function toSqliteVal(val: unknown): unknown {
  if (Buffer.isBuffer(val)) return val;
  if (
    typeof val === "object" &&
    val !== null &&
    (val as { type?: unknown }).type === "Buffer" &&
    Array.isArray((val as { data?: unknown }).data)
  ) {
    return Buffer.from((val as { data: number[] }).data);
  }
  return val;
}

export function applyChanges(db: Database.Database, rows: ChangesetRow[]): void {
  if (rows.length > MAX_CHANGESET_ROWS) {
    throw new Error(`Changeset too many rows: ${rows.length} (max ${MAX_CHANGESET_ROWS})`);
  }
  for (const row of rows) {
    if (!CRDT_TABLES.has(row.tbl)) {
      throw new Error(`Changeset targets non-CRDT table: ${row.tbl}`);
    }
    if (row.pk === null || row.pk === undefined || row.pk === "") {
      throw new Error(`Changeset row has invalid pk: must be non-empty`);
    }
    if (JSON.stringify(row.pk).length > MAX_PK_SERIALIZED_LEN) {
      throw new Error(`Changeset row has invalid pk: serialized length exceeds ${MAX_PK_SERIALIZED_LEN}`);
    }
    if (!Number.isInteger(row.col_version) || row.col_version < 0) {
      throw new Error(`Changeset row has invalid col_version: must be a non-negative integer`);
    }
    if (!Number.isInteger(row.db_version) || row.db_version < 0) {
      throw new Error(`Changeset row has invalid db_version: must be a non-negative integer`);
    }
  }
  const stmt = db.prepare(
    'INSERT INTO crsql_changes ("table", pk, cid, val, col_version, db_version, site_id, cl, seq) ' +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    for (const row of rows) {
      stmt.run(row.tbl, toBlob(row.pk), row.cid, toSqliteVal(row.val), row.col_version, row.db_version, toBlob(row.site_id), row.cl, row.seq);
    }
  })();
}
