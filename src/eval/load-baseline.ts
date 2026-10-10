// Load a load plan into a test DB with the BASELINE code (`--kb-src`), writing <db>.id-map.json
// (source_key -> content id) because the baseline schema has no source_key column.
//   node --import tsx src/eval/load-baseline.ts --kb-src <tree> --plan <load-plan.json> --db <path>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadKb, openWith } from "./kb-src.js";
import type { LoadPlan } from "../import/plan.js";

function arg(argv: string[], name: string): string {
  const i = argv.indexOf(name);
  if (i < 0 || !argv[i + 1]) throw new Error(`${name} is required`);
  return argv[i + 1];
}

export async function loadBaseline(kbSrc: string, planPath: string, dbPath: string): Promise<{ ids: Record<string, number>; ms: number }> {
  if (existsSync(dbPath)) throw new Error(`${dbPath} already exists — use a fresh path`);
  const started = Date.now();
  const kb = await loadKb(kbSrc);
  const db = openWith(kb, dbPath);
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as LoadPlan;
  const ids: Record<string, number> = {};
  for (const item of plan.items) {
    const r = await kb.createContent(db, item.workspace, item.features, item.type, item.body, item.title);
    ids[item.source_key] = r.id;
  }
  for (const l of plan.links) kb.linkContent(db, ids[l.child_source_key], ids[l.parent_source_key]);
  db.close();
  writeFileSync(`${dbPath}.id-map.json`, JSON.stringify(ids, null, 2));
  return { ids, ms: Date.now() - started };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const r = await loadBaseline(arg(argv, "--kb-src"), arg(argv, "--plan"), arg(argv, "--db"));
  process.stdout.write(JSON.stringify({ items: Object.keys(r.ids).length, import_ms: r.ms }) + "\n");
}
