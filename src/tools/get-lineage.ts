import type Database from "better-sqlite3";
import type { LinkedContent, LineageResult } from "../types.js";

// One statement for the whole lineage, so the number of queries no longer grows with it.
// `up` follows only the smallest-rowid parent (the row the old per-node `.get()` returned);
// `down` follows every child. UNION (not UNION ALL) stops both walks at a cycle.
// kind 0 = ancestor edge (a=child, b=parent, k=rowid), kind 1 = descendant edge
// (a=parent, b=child, k=child), kind 2 = node × feature (a=id, b=feature id, k=feature name).
const LINEAGE_SQL = `
  WITH RECURSIVE
    up(id) AS (
      SELECT ?
      UNION
      SELECT (SELECT l.parent_id FROM content_links l WHERE l.child_id = up.id ORDER BY l.rowid LIMIT 1)
      FROM up WHERE up.id IS NOT NULL
    ),
    down(id) AS (
      SELECT ?
      UNION
      SELECT l.child_id FROM content_links l JOIN down ON l.parent_id = down.id
    )
  SELECT 0 AS kind, l.child_id AS a, l.parent_id AS b, l.rowid AS k, NULL AS workspace, NULL AS type, NULL AS title
    FROM content_links l WHERE l.child_id IN (SELECT id FROM up)
  UNION ALL
  SELECT 1, l.parent_id, l.child_id, l.child_id, NULL, NULL, NULL
    FROM content_links l WHERE l.parent_id IN (SELECT id FROM down)
  UNION ALL
  SELECT 2, c.id, f.id, f.name, w.name, c.type, c.title
    FROM contents c
    JOIN content_features cf ON cf.content_id = c.id
    JOIN features f ON cf.feature_id = f.id
    JOIN workspaces w ON f.workspace_id = w.id
    WHERE c.id IN (SELECT id FROM up UNION SELECT id FROM down)
  ORDER BY kind, a, k`;

type LineageRow = {
  kind: number;
  a: number;
  b: number;
  k: number | string;
  workspace: string | null;
  type: string | null;
  title: string | null;
};

type LineageGraph = {
  parentOf: Map<number, number>;
  childrenOf: Map<number, number[]>;
  nodes: Map<number, LinkedContent>;
};

// Prepared once per connection; a WeakMap never keeps a closed connection alive.
const lineageStatements = new WeakMap<Database.Database, Database.Statement>();

function lineageStatement(db: Database.Database): Database.Statement {
  let stmt = lineageStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(LINEAGE_SQL);
    lineageStatements.set(db, stmt);
  }
  return stmt;
}

function buildGraph(rows: LineageRow[]): LineageGraph {
  const parentOf = new Map<number, number>();
  const childrenOf = new Map<number, number[]>();
  const nodes = new Map<number, LinkedContent>();
  const minFeatureId = new Map<number, number>();

  for (const row of rows) {
    if (row.kind === 0) {
      // Rows arrive ordered by rowid — keep the first, as the old `.get()` did.
      if (!parentOf.has(row.a)) parentOf.set(row.a, row.b);
    } else if (row.kind === 1) {
      const children = childrenOf.get(row.a);
      if (children) children.push(row.b);
      else childrenOf.set(row.a, [row.b]);
    } else {
      const node = nodes.get(row.a);
      if (!node) {
        nodes.set(row.a, {
          id: row.a,
          workspace: row.workspace as string,
          type: row.type as string,
          title: row.title,
          features: [row.k as string],
        });
        minFeatureId.set(row.a, row.b);
      } else {
        node.features.push(row.k as string);
        // Workspace of the lowest feature id, matching the old un-ordered `LIMIT 1`.
        if (row.b < minFeatureId.get(row.a)!) {
          node.workspace = row.workspace as string;
          minFeatureId.set(row.a, row.b);
        }
      }
    }
  }

  return { parentOf, childrenOf, nodes };
}

// Fresh object per occurrence, in the key order of the old `{ ...row, features }`.
function copyNode(node: LinkedContent): LinkedContent {
  return { id: node.id, workspace: node.workspace, type: node.type, title: node.title, features: [...node.features] };
}

export function getLineage(db: Database.Database, contentId: number): LineageResult {
  const rows = lineageStatement(db).all(contentId, contentId) as LineageRow[];
  const graph = buildGraph(rows);

  const rootNode = graph.nodes.get(contentId);
  if (!rootNode) throw new Error(`Content not found: id=${contentId}`);
  const root = copyNode(rootNode);

  const ancestors = walkAncestors(graph, contentId);
  const descendants = walkDescendants(graph, contentId);

  return { root, ancestors, descendants };
}

function walkAncestors(graph: LineageGraph, startId: number): LinkedContent[] {
  const ancestors: LinkedContent[] = [];
  const visited = new Set<number>();
  let currentId = startId;

  while (true) {
    const parentId = graph.parentOf.get(currentId);

    if (parentId === undefined || visited.has(parentId)) break;

    visited.add(parentId);
    const ancestor = graph.nodes.get(parentId);
    if (!ancestor) break;
    ancestors.push(copyNode(ancestor));
    currentId = parentId;
  }

  return ancestors;
}

function walkDescendants(graph: LineageGraph, startId: number): LinkedContent[] {
  const descendants: LinkedContent[] = [];
  const visited = new Set<number>([startId]);
  const queue: number[] = [startId];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = graph.childrenOf.get(parentId) ?? [];

    for (const child_id of children) {
      if (visited.has(child_id)) continue;
      visited.add(child_id);
      const child = graph.nodes.get(child_id);
      if (!child) continue;
      descendants.push(copyNode(child));
      queue.push(child_id);
    }
  }

  return descendants;
}
