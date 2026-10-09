import type Database from "better-sqlite3";

// Seed order for the conventional types. This is initial knowledge, not a whitelist:
// any other type is ordered by what existing links say about it.
export const SEED_TYPE_ORDER: readonly string[] = ["idea", "spec", "plan"];

type PairCounts = Map<string, number>;

const pairKey = (parentType: string, childType: string) => `${parentType}\u0000${childType}`;

// Counts existing (parent.type, child.type) pairs in content_links, across all workspaces.
// `excludeLink` drops one link from the count — used when the link being judged was just inserted.
function loadPairCounts(db: Database.Database, excludeLink?: { parentId: number; childId: number }): PairCounts {
  const rows = db
    .prepare(
      `SELECT p.type AS parent_type, c.type AS child_type, COUNT(*) AS n
       FROM content_links cl
       JOIN contents p ON p.id = cl.parent_id
       JOIN contents c ON c.id = cl.child_id
       WHERE NOT (cl.parent_id = ? AND cl.child_id = ?)
       GROUP BY p.type, c.type`,
    )
    .all(excludeLink?.parentId ?? -1, excludeLink?.childId ?? -1) as { parent_type: string; child_type: string; n: number }[];

  const counts: PairCounts = new Map();
  for (const r of rows) counts.set(pairKey(r.parent_type, r.child_type), r.n);
  return counts;
}

const seedIndex = (type: string) => SEED_TYPE_ORDER.indexOf(type);

/**
 * Returns a human-readable reason when `parentType → childType` runs against the known order,
 * or null when it is in order or there is not enough evidence to judge (cold start).
 */
export function reverseDirectionReason(
  db: Database.Database,
  parentType: string,
  childType: string,
  excludeLink?: { parentId: number; childId: number },
): string | null {
  const p = seedIndex(parentType);
  const c = seedIndex(childType);
  if (p !== -1 && c !== -1) {
    return p >= c ? `default order is ${SEED_TYPE_ORDER.join("→")}` : null;
  }
  if (parentType === childType) return null;

  const counts = loadPairCounts(db, excludeLink);
  const forward = counts.get(pairKey(parentType, childType)) ?? 0;
  const reverse = counts.get(pairKey(childType, parentType)) ?? 0;
  if (reverse > forward) {
    return `existing links go ${childType}→${parentType} ${reverse} time(s) vs ${parentType}→${childType} ${forward} time(s)`;
  }
  return null;
}

/**
 * Types that should not be suggested as a parent of `type`: the type itself, and every type
 * known to come after it (seed order for seeded pairs, learned link direction otherwise).
 */
export function typesAfter(db: Database.Database, type: string): Set<string> {
  const excluded = new Set<string>([type]);

  const idx = seedIndex(type);
  if (idx !== -1) {
    for (const t of SEED_TYPE_ORDER.slice(idx + 1)) excluded.add(t);
  }

  const counts = loadPairCounts(db);
  for (const [key, forward] of counts) {
    const [parentType, childType] = key.split("\u0000");
    if (parentType !== type || childType === type) continue;
    if (idx !== -1 && seedIndex(childType) !== -1) continue; // seeded pairs are decided by the seed
    const reverse = counts.get(pairKey(childType, type)) ?? 0;
    if (forward > reverse) excluded.add(childType);
  }

  return excluded;
}
