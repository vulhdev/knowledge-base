import type Database from "better-sqlite3";
import { fetchFeatures } from "./_helpers.js";

export type DetachFeatureResult = { content_id: number; features: string[] };

export function detachFeature(
  db: Database.Database,
  contentId: number,
  workspace: string,
  featureName: string,
): DetachFeatureResult {
  const content = db
    .prepare(
      `SELECT c.id FROM contents c
       JOIN content_features cf ON cf.content_id = c.id
       JOIN features f ON cf.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ? AND w.name = ?
       LIMIT 1`,
    )
    .get(contentId, workspace) as { id: number } | undefined;

  if (!content) {
    throw new Error(`Content not found: id=${contentId} in workspace=${workspace}`);
  }

  const feat = db
    .prepare(
      `SELECT f.id FROM features f
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE w.name = ? AND f.name = ?`,
    )
    .get(workspace, featureName) as { id: number } | undefined;

  if (!feat) {
    throw new Error(`Feature "${featureName}" not found in workspace=${workspace}`);
  }

  const link = db
    .prepare(`SELECT 1 FROM content_features WHERE content_id = ? AND feature_id = ?`)
    .get(contentId, feat.id);

  if (!link) {
    throw new Error(`Content ${contentId} is not attached to feature "${featureName}"`);
  }

  const featureCount = (
    db
      .prepare(`SELECT COUNT(*) AS cnt FROM content_features WHERE content_id = ?`)
      .get(contentId) as { cnt: number }
  ).cnt;

  if (featureCount <= 1) {
    throw new Error(`Cannot detach last feature from content ${contentId}`);
  }

  db.prepare(`DELETE FROM content_features WHERE content_id = ? AND feature_id = ?`).run(contentId, feat.id);

  return { content_id: contentId, features: fetchFeatures(db, contentId) };
}
