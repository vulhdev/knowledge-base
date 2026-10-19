import type Database from "better-sqlite3";
import { isModelReady, getEmbedding } from "./model.js";
import { embedPendingDocSections } from "../tools/_chunks.js";

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

      if (rows.length > 0) {
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
      }

      // Sections: docs without sections, or with sections lacking vectors, are re-split with the
      // real tokenizer and embedded. SOT pointers are refilled by re-running import-sources.
      const sectioned = await embedPendingDocSections(db);
      if (sectioned > 0) {
        process.stderr.write(`[knowledge-base] Section backfill complete (${sectioned} documents)\n`);
      }
    } finally {
      onDone?.();
    }
  })();
}
