import type Database from "better-sqlite3";

export type ChangesetRow = {
  tbl: string;
  pk: string;
  cid: string;
  val: unknown;
  col_version: number;
  db_version: number;
  site_id: string;
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
      'SELECT "table" AS tbl, pk, cid, val, col_version, db_version, site_id ' +
      "FROM crsql_changes WHERE db_version > ?",
    )
    .all(sinceVersion) as ChangesetRow[];
}

export function applyChanges(db: Database.Database, rows: ChangesetRow[]): void {
  if (rows.length > MAX_CHANGESET_ROWS) {
    throw new Error(`Changeset too many rows: ${rows.length} (max ${MAX_CHANGESET_ROWS})`);
  }
  for (const row of rows) {
    if (!CRDT_TABLES.has(row.tbl)) {
      throw new Error(`Changeset targets non-CRDT table: ${row.tbl}`);
    }
  }
  const stmt = db.prepare(
    'INSERT INTO crsql_changes ("table", pk, cid, val, col_version, db_version, site_id) ' +
    "VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    for (const row of rows) {
      stmt.run(row.tbl, row.pk, row.cid, row.val, row.col_version, row.db_version, row.site_id);
    }
  })();
}
