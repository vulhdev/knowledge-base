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
