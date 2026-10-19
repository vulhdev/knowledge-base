// Load KB modules from a source tree (the current repo or an extracted baseline) by dynamic import,
// and open a test database with that tree's own schema code.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { assertNotRealDb } from "../db/client.js";

type Db = Database.Database;

export type KbModules = {
  applySchema: (db: Db) => void;
  createContent: (db: Db, ws: string, features: string[], type: string, body: string, title?: string) => Promise<{ id: number }>;
  linkContent: (db: Db, childId: number, parentId: number) => unknown;
  searchSemantic: (db: Db, q: string, ws?: string, type?: string, limit?: number, offset?: number) => Promise<{
    results: { id: number; score: number; body: string; matched_sections?: { chunk_key: string; heading_path: string; start_line: number; end_line: number; source_path?: string; source_commit?: string }[] }[];
  }>;
};

export async function loadKb(kbSrc: string): Promise<KbModules> {
  const mod = async (p: string) => import(pathToFileURL(resolve(kbSrc, p)).href);
  const [schema, create, link, search] = await Promise.all([
    mod("src/db/schema.ts"),
    mod("src/tools/create-content.ts"),
    mod("src/tools/link-content.ts"),
    mod("src/tools/search-semantic.ts"),
  ]);
  return { applySchema: schema.applySchema, createContent: create.createContent, linkContent: link.linkContent, searchSemantic: search.searchSemantic };
}

export function openWith(kb: KbModules, dbPath: string): Db {
  assertNotRealDb(dbPath);
  const db = new Database(dbPath);
  loadSqliteVec(db);
  kb.applySchema(db);
  return db;
}
