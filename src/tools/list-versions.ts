import type Database from "better-sqlite3";
import type { ListVersionsResult, VersionSummary } from "../types.js";
import { logInfo } from "../log/logger.js";

export function listVersions(db: Database.Database, id: string): ListVersionsResult {
  const t0 = Date.now();
  logInfo("list_versions", { event: "start", id });
  const row = db
    .prepare("SELECT id, root_id FROM contents WHERE id = ?")
    .get(id) as { id: string; root_id: string | null } | undefined;

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

  const result = {
    root_id: chainRoot,
    versions: versions.map((v) => ({ ...v, is_latest: v.is_latest === 1 })),
  };
  logInfo("list_versions", { event: "done", ms: String(Date.now() - t0), count: result.versions.length });
  return result;
}
