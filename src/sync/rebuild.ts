import type Database from "better-sqlite3";

// contents_fts is a contentless_delete table (migration 14) — FTS is maintained
// by triggers on contents, so no manual rebuild is required after CRDT sync.
export function rebuildFts(_db: Database.Database): void {
  // no-op
}
