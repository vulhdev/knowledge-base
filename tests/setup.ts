import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { applySchema } from "../src/db/schema.js";

export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  loadSqliteVec(db);
  applySchema(db);
  return db;
}
