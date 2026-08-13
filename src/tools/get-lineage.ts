import type Database from "better-sqlite3";
import type { LinkedContent, LineageResult } from "../types.js";
import { fetchFeatures } from "./_helpers.js";

function fetchLinkedContent(db: Database.Database, id: number): LinkedContent | undefined {
  type RawRow = Omit<LinkedContent, "features">;
  const row = db
    .prepare(
      `SELECT c.id, w.name AS workspace, c.type, c.title
       FROM contents c
       JOIN content_features cf ON cf.content_id = c.id
       JOIN features f ON cf.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?
       LIMIT 1`,
    )
    .get(id) as RawRow | undefined;
  if (!row) return undefined;
  return { ...row, features: fetchFeatures(db, id) };
}

export function getLineage(db: Database.Database, contentId: number): LineageResult {
  const root = fetchLinkedContent(db, contentId);
  if (!root) throw new Error(`Content not found: id=${contentId}`);

  const ancestors = walkAncestors(db, contentId);
  const descendants = walkDescendants(db, contentId);

  return { root, ancestors, descendants };
}

function walkAncestors(db: Database.Database, startId: number): LinkedContent[] {
  const ancestors: LinkedContent[] = [];
  const visited = new Set<number>();
  let currentId = startId;

  while (true) {
    const parentRow = db
      .prepare("SELECT parent_id FROM content_links WHERE child_id = ?")
      .get(currentId) as { parent_id: number } | undefined;

    if (!parentRow || visited.has(parentRow.parent_id)) break;

    visited.add(parentRow.parent_id);
    const ancestor = fetchLinkedContent(db, parentRow.parent_id);
    if (!ancestor) break;
    ancestors.push(ancestor);
    currentId = parentRow.parent_id;
  }

  return ancestors;
}

function walkDescendants(db: Database.Database, startId: number): LinkedContent[] {
  const descendants: LinkedContent[] = [];
  const visited = new Set<number>([startId]);
  const queue: number[] = [startId];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = db
      .prepare("SELECT child_id FROM content_links WHERE parent_id = ?")
      .all(parentId) as { child_id: number }[];

    for (const { child_id } of children) {
      if (visited.has(child_id)) continue;
      visited.add(child_id);
      const child = fetchLinkedContent(db, child_id);
      if (!child) continue;
      descendants.push(child);
      queue.push(child_id);
    }
  }

  return descendants;
}
