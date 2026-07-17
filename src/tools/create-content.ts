import type Database from "better-sqlite3";
import type { ContentType, CreateContentResult } from "../types.js";

export function createContent(
  db: Database.Database,
  workspace: string,
  feature: string,
  type: ContentType,
  body: string,
  title?: string,
): CreateContentResult {
  if (!body.trim()) {
    throw new Error("body must not be empty");
  }

  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(workspace);
  const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(workspace) as { id: number };

  db.prepare("INSERT OR IGNORE INTO features (workspace_id, name) VALUES (?, ?)").run(ws.id, feature);
  const ft = db.prepare("SELECT id FROM features WHERE workspace_id = ? AND name = ?").get(ws.id, feature) as { id: number };

  const { lastInsertRowid } = db
    .prepare("INSERT INTO contents (feature_id, type, title, body) VALUES (?, ?, ?, ?)")
    .run(ft.id, type, title ?? null, body);

  const row = db
    .prepare("SELECT id, title, created_at FROM contents WHERE id = ?")
    .get(Number(lastInsertRowid)) as { id: number; title: string | null; created_at: string };

  return { id: row.id, workspace, feature, type, title: row.title, created_at: row.created_at };
}
