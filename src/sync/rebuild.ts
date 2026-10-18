import type Database from "better-sqlite3";

export function rebuildFts(db: Database.Database): void {
  db.exec("INSERT INTO contents_fts(contents_fts) VALUES ('rebuild')");
}
