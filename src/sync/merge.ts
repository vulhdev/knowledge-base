import type Database from "better-sqlite3";

export type MergeResult = {
  featuresRenamed: string[];
  featuresMoved: number;
};

export function mergeWorkspace(
  db: Database.Database,
  srcName: string,
  dstName: string,
): MergeResult {
  const src = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(srcName) as { id: number } | undefined;
  const dst = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(dstName) as { id: number } | undefined;
  if (!src) throw new Error(`Workspace "${srcName}" not found`);
  if (!dst) throw new Error(`Workspace "${dstName}" not found`);
  if (src.id === dst.id) throw new Error(`Source and destination are the same workspace`);

  return db.transaction((): MergeResult => {
    const srcFeatures = db
      .prepare("SELECT id, name FROM features WHERE workspace_id = ?")
      .all(src.id) as { id: string; name: string }[];

    if (srcFeatures.length === 0) {
      return { featuresRenamed: [], featuresMoved: 0 };
    }

    const dstNames = new Set(
      (db.prepare("SELECT name FROM features WHERE workspace_id = ?").all(dst.id) as { name: string }[])
        .map((r) => r.name),
    );

    const renamed: string[] = [];
    const renameStmt = db.prepare("UPDATE features SET name = ? WHERE id = ?");
    const moveStmt   = db.prepare("UPDATE features SET workspace_id = ? WHERE id = ?");

    for (const feat of srcFeatures) {
      if (dstNames.has(feat.name)) {
        const newName = `${feat.name} [${srcName}]`;
        renameStmt.run(newName, feat.id);
        dstNames.add(newName);
        renamed.push(feat.name);
      }
      moveStmt.run(dst.id, feat.id);
    }

    return { featuresRenamed: renamed, featuresMoved: srcFeatures.length };
  })();
}
