// Apply a load plan to a test database: branch A docs (+ fork residues and links) through
// createContent / updateContent with provenance, branch B cards through importSotCard.
// Idempotent: an unchanged source writes nothing.
import type Database from "better-sqlite3";
import { openDbAt } from "../db/client.js";
import { createContent } from "../tools/create-content.js";
import { updateContent } from "../tools/update-content.js";
import { linkContent } from "../tools/link-content.js";
import { embedPendingDocSections } from "../tools/_chunks.js";
import { importSotCard, removeMissingSotFiles } from "./sot.js";
import type { LoadPlan, PlanCard, PlanDoc } from "./plan.js";

export type ApplyResult = {
  ref: string | null;
  sot_commit: string | null;
  docs: { created: number; updated: number; unchanged: number; residues: number; links: number };
  cards: { created: number; updated: number; unchanged: number; deleted: number };
  pointers: number;
  doc_count: number;
  residue_count: number;
  card_count: number;
  missing_embeddings: number;
  writes: number;
  errors: string[];
  exit_code: number;
};

const totalChanges = (db: Database.Database) => (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;

export async function applyDocs(db: Database.Database, plan: LoadPlan, r: ApplyResult): Promise<void> {
  const idOf = new Map<string, number>();
  for (const item of plan.items.filter((i): i is PlanDoc => i.kind !== "card")) {
    try {
      const prov = { source_key: item.source_key, source_sha: item.source_sha };
      const existing = db.prepare("SELECT id, source_sha FROM contents WHERE source_key = ?").get(item.source_key) as { id: number; source_sha: string } | undefined;
      if (!existing) {
        // no requestSampling: a CLI run has no MCP client, so conflict detection is skipped (FR-A9)
        idOf.set(item.source_key, (await createContent(db, item.workspace, item.features, item.type, item.body, item.title, undefined, prov)).id);
        r.docs.created++;
      } else if (existing.source_sha !== item.source_sha) {
        await updateContent(db, existing.id, item.body, item.type, item.title, undefined, prov);
        idOf.set(item.source_key, existing.id);
        r.docs.updated++;
      } else {
        idOf.set(item.source_key, existing.id);
        r.docs.unchanged++;
      }
      if (item.kind === "residue") r.docs.residues++;
    } catch (err) {
      r.errors.push(`${item.source_key}: ${(err as Error).message}`);
    }
  }
  for (const l of plan.links) {
    const parent = idOf.get(l.parent_source_key);
    const child = idOf.get(l.child_source_key);
    if (parent === undefined || child === undefined) continue;
    const before = totalChanges(db);
    linkContent(db, child, parent);
    if (totalChanges(db) > before) r.docs.links++;
  }
}

export async function applyCards(db: Database.Database, plan: LoadPlan, r: ApplyResult): Promise<number> {
  const cards = plan.items.filter((i): i is PlanCard => i.kind === "card");
  let failed = 0;
  for (const card of cards) {
    try {
      const o = await importSotCard(db, card);
      r.cards[o.status]++;
      r.pointers += o.pointers;
    } catch (err) {
      failed++;
      r.errors.push(`${card.source_key}: ${(err as Error).message}`);
    }
  }
  // only prune when every listed file was read; a failed read must not look like a deletion
  // files present at the ref but skipped while planning (unreadable, binary) also count as present
  const present = new Set([...cards.map((c) => c.source_key), ...(plan.skipped_keys ?? [])]);
  if (failed === 0) r.cards.deleted = removeMissingSotFiles(db, plan.sot_scopes, present);
  r.ref = cards[0]?.ref ?? null;
  r.sot_commit = cards[0]?.ref_commit ?? null;
  return cards.length === 0 ? 0 : failed === cards.length ? 1 : 0;
}

export async function applyPlanToDb(db: Database.Database, plan: LoadPlan): Promise<ApplyResult> {
  const r: ApplyResult = {
    ref: null, sot_commit: null,
    docs: { created: 0, updated: 0, unchanged: 0, residues: 0, links: 0 },
    cards: { created: 0, updated: 0, unchanged: 0, deleted: 0 },
    pointers: 0, doc_count: 0, residue_count: 0, card_count: 0, missing_embeddings: 0, writes: 0, errors: [], exit_code: 0,
  };
  const before = totalChanges(db);
  await applyDocs(db, plan, r);
  const aErrors = r.errors.length;
  const bFailed = await applyCards(db, plan, r);
  // sections whose vectors failed earlier (or docs sectioned before the model was present)
  await embedPendingDocSections(db);
  r.writes = totalChanges(db) - before;

  const count = (sql: string, ...p: string[]) => (db.prepare(sql).get(...p) as { n: number }).n;
  const inWs = `SELECT count(DISTINCT c.id) AS n FROM contents c JOIN content_features cf ON cf.content_id = c.id
                JOIN features f ON f.id = cf.feature_id JOIN workspaces w ON w.id = f.workspace_id WHERE w.name = ?`;
  r.doc_count = count(`${inWs} AND c.type <> 'fork-residue'`, plan.workspace);
  r.residue_count = count(`${inWs} AND c.type = 'fork-residue'`, plan.workspace);
  r.card_count = count(`${inWs} AND c.source_key LIKE 'sot:%'`, plan.sot_workspace);
  r.missing_embeddings =
    count("SELECT count(*) AS n FROM contents WHERE embedding IS NULL") +
    count("SELECT count(*) AS n FROM content_chunks WHERE embedding IS NULL");
  r.exit_code = aErrors > 0 || bFailed > 0 ? 1 : 0;
  return r;
}

export async function applyPlan(dbPath: string, plan: LoadPlan): Promise<ApplyResult> {
  const db = openDbAt(dbPath);
  try {
    return await applyPlanToDb(db, plan);
  } finally {
    db.close();
  }
}
