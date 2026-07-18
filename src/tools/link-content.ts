import type Database from "better-sqlite3";
import type { LinkResult } from "../types.js";

const TYPE_ORDER: Record<string, number> = { idea: 1, spec: 2, plan: 3 };

export function linkContent(
  db: Database.Database,
  childId: number,
  parentId: number,
): LinkResult {
  const parent = db
    .prepare(
      `SELECT c.id, c.type, w.name AS workspace
       FROM contents c
       JOIN features f ON c.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?`,
    )
    .get(parentId) as { id: number; type: string; workspace: string } | undefined;

  if (!parent) throw new Error(`Content not found: id=${parentId}`);

  const child = db
    .prepare(
      `SELECT c.id, c.type, w.name AS workspace
       FROM contents c
       JOIN features f ON c.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?`,
    )
    .get(childId) as { id: number; type: string; workspace: string } | undefined;

  if (!child) throw new Error(`Content not found: id=${childId}`);

  db.prepare("INSERT OR IGNORE INTO content_links (parent_id, child_id) VALUES (?, ?)").run(parentId, childId);

  const row = db
    .prepare("SELECT created_at FROM content_links WHERE parent_id = ? AND child_id = ?")
    .get(parentId, childId) as { created_at: string };

  const result: LinkResult = { parent_id: parentId, child_id: childId, created_at: row.created_at };

  const parentOrder = TYPE_ORDER[parent.type];
  const childOrder = TYPE_ORDER[child.type];

  if (parentOrder !== undefined && childOrder !== undefined && parentOrder >= childOrder) {
    result.direction_warning = `Expected parent type to precede child type (idea→spec→plan), but got ${parent.type}→${child.type}`;
  } else if (parent.workspace !== child.workspace) {
    result.direction_warning = `Parent (workspace: ${parent.workspace}) and child (workspace: ${child.workspace}) are in different workspaces`;
  }

  return result;
}
