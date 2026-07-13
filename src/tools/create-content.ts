import type { DatabaseSync } from "node:sqlite";
import type { ContentType, CreateContentResult } from "../types.js";

const VALID_TYPES: readonly ContentType[] = ["idea", "spec", "plan", "digest"];

export function createContent(
  db: DatabaseSync,
  workspace: string,
  feature: string,
  type: ContentType,
  body: string,
): CreateContentResult {
  if (!VALID_TYPES.includes(type)) {
    throw new Error(`type must be one of: ${VALID_TYPES.join(", ")}`);
  }
  if (!body.trim()) {
    throw new Error("body must not be empty");
  }

  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(workspace);
  const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(workspace) as { id: number };

  db.prepare("INSERT OR IGNORE INTO features (workspace_id, name) VALUES (?, ?)").run(ws.id, feature);
  const ft = db.prepare("SELECT id FROM features WHERE workspace_id = ? AND name = ?").get(ws.id, feature) as { id: number };

  const { lastInsertRowid } = db.prepare("INSERT INTO contents (feature_id, type, body) VALUES (?, ?, ?)").run(ft.id, type, body);

  const row = db.prepare("SELECT id, created_at FROM contents WHERE id = ?").get(Number(lastInsertRowid)) as { id: number; created_at: string };

  return { id: row.id, workspace, feature, type, created_at: row.created_at };
}
