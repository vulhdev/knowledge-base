// knowledge-base import-sources — import personal docs (branch A) and SOT pointers (branch B)
// into a database chosen by path. Never opens the user's live database.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNotRealDb } from "../db/client.js";
import { scanSources } from "../import/scan.js";
import { buildLoadPlan, type LoadPlan } from "../import/plan.js";
import { gitRoot, resolveRef } from "../import/git.js";

export type ImportArgs = {
  db: string;
  workspace: string;
  sotWorkspace: string;
  ref?: string;
  planOut?: string;
  dryRun: boolean;
  report?: string;
  dirs: string[];
};

export function parseArgs(argv: string[]): ImportArgs {
  const a: Partial<ImportArgs> & { dirs: string[]; dryRun: boolean } = { dirs: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case "--db": a.db = next(); break;
      case "--workspace": a.workspace = next(); break;
      case "--sot-workspace": a.sotWorkspace = next(); break;
      case "--ref": a.ref = next(); break;
      case "--plan-out": a.planOut = next(); break;
      case "--report": a.report = next(); break;
      case "--dry-run": a.dryRun = true; break;
      default:
        if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
        a.dirs.push(arg);
    }
  }
  if (!a.db) throw new Error("--db <path> is required");
  if (!a.workspace) throw new Error("--workspace <name> is required");
  if (a.dirs.length === 0) throw new Error("at least one <source-dir> is required");
  return { ...a, sotWorkspace: a.sotWorkspace ?? `${a.workspace}-sot` } as ImportArgs;
}

export function kbCommit(): string {
  try {
    const root = gitRoot(dirname(fileURLToPath(import.meta.url)));
    return root ? resolveRef(root, "HEAD").commit : "unknown";
  } catch {
    return "unknown";
  }
}

export function renderReport(plan: LoadPlan, extra: string[] = []): string {
  const s = plan.stats;
  return [
    "# import-sources report",
    "",
    `- workspace: ${plan.workspace} · sot workspace: ${plan.sot_workspace}`,
    `- files: A=${s.files_a} B=${s.files_b}`,
    `- docs: ${s.docs} canonical + ${s.residues} fork-residue = ${s.docs + s.residues}`,
    `- cards: ${s.cards}`,
    `- aliases: ${s.aliases} · series links: ${s.series_links}`,
    ...extra,
    "",
    "## Dedup log",
    "",
    ...plan.log.map((l) => `- ${l}`),
    "",
    "## Warnings",
    "",
    ...(plan.warnings.length ? plan.warnings.map((w) => `- ${w}`) : ["- none"]),
    "",
  ].join("\n");
}

function writeFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export async function main(argv: string[]): Promise<number> {
  let args: ImportArgs;
  try {
    args = parseArgs(argv);
    assertNotRealDb(args.db);
  } catch (err) {
    process.stderr.write(`import-sources: ${(err as Error).message}\n`);
    return 2;
  }

  const started = Date.now();
  const scan = scanSources(args.dirs, { ref: args.ref });
  const plan = buildLoadPlan(scan, args.workspace, args.sotWorkspace);
  if (args.planOut) writeFile(args.planOut, JSON.stringify(plan, null, 2));

  if (args.dryRun) {
    if (args.report) writeFile(args.report, renderReport(plan));
    process.stdout.write(JSON.stringify({ dry_run: true, db: args.db, kb_commit: kbCommit(), stats: plan.stats, warnings: plan.warnings.length, elapsed_ms: Date.now() - started }) + "\n");
    return 0;
  }

  const { applyPlan } = await import("../import/apply-docs.js");
  const result = await applyPlan(args.db, plan);
  const out = { db: args.db, kb_commit: kbCommit(), ...result, elapsed_ms: Date.now() - started };
  if (args.report) writeFile(args.report, renderReport(plan, [`- result: \`${JSON.stringify(out)}\``]));
  process.stdout.write(JSON.stringify(out) + "\n");
  return result.exit_code;
}

const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntry || process.argv[2] === "import-sources") {
  const argv = process.argv.slice(process.argv[2] === "import-sources" ? 3 : 2);
  process.exitCode = await main(argv);
}
