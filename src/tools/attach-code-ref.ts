import type Database from "better-sqlite3";
import type { AttachCodeRefResult, CodeRefFile } from "../types.js";

export function attachCodeRef(
  db: Database.Database,
  contentId: number,
  commitHash: string,
  filePaths: CodeRefFile[],
  taskRef?: string,
): AttachCodeRefResult {
  const exists = db.prepare("SELECT id FROM contents WHERE id = ?").get(contentId);
  if (!exists) throw new Error(`Content not found: id=${contentId}`);

  const row = db
    .prepare(
      `INSERT INTO code_refs (content_id, task_ref, commit_hash, file_paths)
       VALUES (?, ?, ?, ?)
       RETURNING id, content_id, task_ref, commit_hash, file_paths, created_at`,
    )
    .get(contentId, taskRef ?? null, commitHash, JSON.stringify(filePaths)) as {
    id: number;
    content_id: number;
    task_ref: string | null;
    commit_hash: string;
    file_paths: string;
    created_at: string;
  };

  return {
    id: row.id,
    content_id: row.content_id,
    task_ref: row.task_ref,
    commit_hash: row.commit_hash,
    file_paths: JSON.parse(row.file_paths) as CodeRefFile[],
    created_at: row.created_at,
  };
}
