import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../src/db/schema.js";

export function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  return db;
}
