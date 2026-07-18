import type Database from "better-sqlite3";
import type { LinkedContent, LineageResult } from "../types.js";

const SELECT_LINKED_CONTENT = `
  SELECT c.id, w.name AS workspace, f.name AS feature, c.type, c.title
  FROM contents c
  JOIN features f ON c.feature_id = f.id
  JOIN workspaces w ON f.workspace_id = w.id
  WHERE c.id = ?
`;

export function getLineage(db: Database.Database, contentId: number): LineageResult {
  const root = db.prepare(SELECT_LINKED_CONTENT).get(contentId) as LinkedContent | undefined;
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
    const ancestor = db.prepare(SELECT_LINKED_CONTENT).get(parentRow.parent_id) as LinkedContent;
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
      const child = db.prepare(SELECT_LINKED_CONTENT).get(child_id) as LinkedContent;
      descendants.push(child);
      queue.push(child_id);
    }
  }

  return descendants;
}
