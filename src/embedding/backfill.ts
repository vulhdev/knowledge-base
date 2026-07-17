import type Database from "better-sqlite3";
import { isModelReady, getEmbedding } from "./model.js";

type Row = { id: number; body: string };

export function startBackfill(db: Database.Database, onDone?: () => void): void {
  void (async () => {
    try {
      if (!isModelReady()) {
        onDone?.();
        return;
      }

      const rows = db
        .prepare("SELECT id, body FROM contents WHERE embedding IS NULL")
        .all() as Row[];

      if (rows.length === 0) {
        onDone?.();
        return;
      }

      process.stderr.write(`[knowledge-base] Backfilling embeddings for ${rows.length} documents...\n`);

      const update = db.prepare("UPDATE contents SET embedding = ? WHERE id = ?");
      let done = 0;

      for (const row of rows) {
        const embedding = await getEmbedding(row.body);
        const blob = Buffer.from(embedding.buffer);
        update.run(blob, row.id);
        done++;
      }

      process.stderr.write(`[knowledge-base] Backfill complete (${done}/${rows.length})\n`);
    } finally {
      onDone?.();
    }
  })();
}
