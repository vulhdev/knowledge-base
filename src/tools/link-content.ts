import type Database from "better-sqlite3";
import type { LinkResult } from "../types.js";
import { reverseDirectionReason } from "./_type-order.js";

export function linkContent(
  db: Database.Database,
  childId: number,
  parentId: number,
): LinkResult {
  const parent = db
    .prepare(
      `SELECT c.id, c.type, w.name AS workspace
       FROM contents c
       JOIN content_features cf ON cf.content_id = c.id
       JOIN features f ON cf.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?
       LIMIT 1`,
    )
    .get(parentId) as { id: number; type: string; workspace: string } | undefined;

  if (!parent) throw new Error(`Content not found: id=${parentId}`);

  const child = db
    .prepare(
      `SELECT c.id, c.type, w.name AS workspace
       FROM contents c
       JOIN content_features cf ON cf.content_id = c.id
       JOIN features f ON cf.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?
       LIMIT 1`,
    )
    .get(childId) as { id: number; type: string; workspace: string } | undefined;

  if (!child) throw new Error(`Content not found: id=${childId}`);

  db.prepare("INSERT OR IGNORE INTO content_links (parent_id, child_id) VALUES (?, ?)").run(parentId, childId);

  const row = db
    .prepare("SELECT created_at FROM content_links WHERE parent_id = ? AND child_id = ?")
    .get(parentId, childId) as { created_at: string };

  const result: LinkResult = { parent_id: parentId, child_id: childId, created_at: row.created_at };

  let reason: string | null = null;
  try {
    reason = reverseDirectionReason(db, parent.type, child.type, { parentId, childId });
  } catch {
    // direction check is advisory — the link is already created
  }

  if (reason) {
    result.direction_warning = `Unexpected type direction ${parent.type}→${child.type}: ${reason}`;
  } else if (parent.workspace !== child.workspace) {
    result.direction_warning = `Parent (workspace: ${parent.workspace}) and child (workspace: ${child.workspace}) are in different workspaces`;
  }

  return result;
}
