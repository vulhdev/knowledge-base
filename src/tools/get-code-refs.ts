import type Database from "better-sqlite3";
import type { AttachCodeRefResult, CodeRefFile, GetCodeRefsResult } from "../types.js";

export function getCodeRefs(db: Database.Database, contentId: number): GetCodeRefsResult {
  const rows = db
    .prepare(
      `SELECT id, content_id, task_ref, commit_hash, file_paths, created_at
       FROM code_refs
       WHERE content_id = ?
       ORDER BY created_at ASC`,
    )
    .all(contentId) as Array<{
    id: number;
    content_id: number;
    task_ref: string | null;
    commit_hash: string;
    file_paths: string;
    created_at: string;
  }>;

  const refs: AttachCodeRefResult[] = rows.map((row) => ({
    id: row.id,
    content_id: row.content_id,
    task_ref: row.task_ref,
    commit_hash: row.commit_hash,
    file_paths: JSON.parse(row.file_paths) as CodeRefFile[],
    created_at: row.created_at,
  }));

  return { content_id: contentId, refs };
}
