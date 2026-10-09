import type Database from "better-sqlite3";

export function fetchFeatures(db: Database.Database, contentId: number): string[] {
  return (
    db
      .prepare(
        `SELECT f.name
         FROM content_features cf
         JOIN features f ON cf.feature_id = f.id
         WHERE cf.content_id = ?
         ORDER BY f.name`,
      )
      .all(contentId) as { name: string }[]
  ).map((r) => r.name);
}

// Feature names for many contents in one query. Ids without features get no key.
export function fetchFeaturesBatch(
  db: Database.Database,
  contentIds: readonly number[],
): Map<number, string[]> {
  const result = new Map<number, string[]>();
  if (contentIds.length === 0) return result;

  const placeholders = contentIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT cf.content_id, f.name
       FROM content_features cf
       JOIN features f ON cf.feature_id = f.id
       WHERE cf.content_id IN (${placeholders})
       ORDER BY cf.content_id, f.name`,
    )
    .all(...contentIds) as { content_id: number; name: string }[];

  for (const row of rows) {
    const names = result.get(row.content_id);
    if (names) {
      names.push(row.name);
    } else {
      result.set(row.content_id, [row.name]);
    }
  }
  return result;
}
