import type Database from "better-sqlite3";
import type { ListVersionsResult, VersionSummary } from "../types.js";

export function listVersions(db: Database.Database, id: number): ListVersionsResult {
  const row = db
    .prepare("SELECT id, root_id FROM contents WHERE id = ?")
    .get(id) as { id: number; root_id: number | null } | undefined;

  if (!row) {
    throw new Error(`Content not found: id=${id}`);
  }

  const chainRoot = row.root_id ?? row.id;

  const versions = db
    .prepare(
      `SELECT id, version_number, is_latest, title, created_at, updated_at
       FROM contents
       WHERE id = ? OR root_id = ?
       ORDER BY version_number ASC`,
    )
    .all(chainRoot, chainRoot) as (Omit<VersionSummary, "is_latest"> & { is_latest: number })[];

  return {
    root_id: chainRoot,
    versions: versions.map((v) => ({ ...v, is_latest: v.is_latest === 1 })),
  };
}
