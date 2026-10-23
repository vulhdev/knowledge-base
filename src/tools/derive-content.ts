import type Database from "better-sqlite3";
import type { CreateContentResult } from "../types.js";
import { createContent } from "./create-content.js";
import { linkContent } from "./link-content.js";
import { fetchFeatures } from "./_helpers.js";
import { logInfo } from "../log/logger.js";

export async function deriveContent(
  db: Database.Database,
  parentId: string,
  type: string,
  body: string,
  title?: string,
): Promise<CreateContentResult & { parent_id: string }> {
  const t0 = Date.now();
  logInfo("derive_content", { event: "start", parent_id: parentId, type });
  const parent = db
    .prepare(
      `SELECT c.id, w.name AS workspace
       FROM contents c
       JOIN content_features cf ON cf.content_id = c.id
       JOIN features f ON cf.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ?
       LIMIT 1`,
    )
    .get(parentId) as { id: string; workspace: string } | undefined;

  if (!parent) throw new Error(`Content not found: id=${parentId}`);

  const parentFeatures = fetchFeatures(db, parentId);
  const created = await createContent(db, parent.workspace, parentFeatures, type, body, title);

  linkContent(db, created.id, parentId);

  logInfo("derive_content", { event: "done", ms: String(Date.now() - t0), content_id: created.id });
  return { ...created, parent_id: parentId };
}
