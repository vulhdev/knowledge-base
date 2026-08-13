import type Database from "better-sqlite3";
import { fetchFeatures } from "./_helpers.js";

export type AttachFeatureResult = { content_id: number; features: string[] };

export function attachFeature(
  db: Database.Database,
  contentId: number,
  workspace: string,
  featureName: string,
): AttachFeatureResult {
  const content = db
    .prepare(
      `SELECT c.id, c.type FROM contents c
       JOIN content_features cf ON cf.content_id = c.id
       JOIN features f ON cf.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE c.id = ? AND w.name = ?
       LIMIT 1`,
    )
    .get(contentId, workspace) as { id: number; type: string } | undefined;

  if (!content) {
    throw new Error(`Content not found: id=${contentId} in workspace=${workspace}`);
  }

  db.prepare(`INSERT OR IGNORE INTO workspaces (name) VALUES (?)`).run(workspace);
  const ws = db.prepare(`SELECT id FROM workspaces WHERE name = ?`).get(workspace) as { id: number };

  db.prepare(`INSERT OR IGNORE INTO features (workspace_id, name) VALUES (?, ?)`).run(ws.id, featureName);
  const feat = db.prepare(`SELECT id FROM features WHERE workspace_id = ? AND name = ?`).get(ws.id, featureName) as {
    id: number;
  };

  if (content.type === "digest") {
    const existingDigest = db
      .prepare(
        `SELECT 1 FROM contents c
         JOIN content_features cf ON cf.content_id = c.id
         WHERE cf.feature_id = ? AND c.type = 'digest' AND c.id != ?`,
      )
      .get(feat.id, contentId);
    if (existingDigest) {
      throw new Error(`Feature "${featureName}" already has a digest document`);
    }
  }

  db.prepare(`INSERT OR IGNORE INTO content_features (content_id, feature_id) VALUES (?, ?)`).run(
    contentId,
    feat.id,
  );

  return { content_id: contentId, features: fetchFeatures(db, contentId) };
}
