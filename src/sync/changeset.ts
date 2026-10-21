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

export function applyChanges(db: Database.Database, rows: ChangesetRow[]): void {
  if (rows.length > MAX_CHANGESET_ROWS) {
    throw new Error(`Changeset too many rows: ${rows.length} (max ${MAX_CHANGESET_ROWS})`);
  }
  for (const row of rows) {
    if (!CRDT_TABLES.has(row.tbl)) {
      throw new Error(`Changeset targets non-CRDT table: ${row.tbl}`);
    }
    // pk may be a string or a Buffer-like object after JSON round-trip; validate presence only.
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
      stmt.run(row.tbl, row.pk, row.cid, row.val, row.col_version, row.db_version, row.site_id, row.cl, row.seq);
    }
  })();
}
