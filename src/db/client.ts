import { DatabaseSync } from "node:sqlite";
import { applySchema } from "./schema.js";

let instance: DatabaseSync | null = null;

export function openDb(): DatabaseSync {
  if (instance) return instance;

  const dbPath = process.env.DB_PATH;
  if (!dbPath) {
    throw new Error("DB_PATH environment variable is not set");
  }

  instance = new DatabaseSync(dbPath);
  applySchema(instance);
  return instance;
}
