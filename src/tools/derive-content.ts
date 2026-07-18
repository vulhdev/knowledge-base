import type Database from "better-sqlite3";
import type { CreateContentResult } from "../types.js";
import { createContent } from "./create-content.js";
import { linkContent } from "./link-content.js";

export async function deriveContent(
  db: Database.Database,
  parentId: number,
  type: string,
  body: string,
  title?: string,
): Promise<CreateContentResult & { parent_id: number }> {
  const parent = db
    .prepare(
      `SELECT c.id, w.name AS workspace, f.name AS feature
       FROM contents c
       JOIN features f ON c.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?`,
    )
    .get(parentId) as { id: number; workspace: string; feature: string } | undefined;

  if (!parent) throw new Error(`Content not found: id=${parentId}`);

  const created = await createContent(db, parent.workspace, parent.feature, type, body, title);

  linkContent(db, created.id, parentId);

  return { ...created, parent_id: parentId };
}
