import type { LoadPlan } from "./plan.js";

export type ApplyResult = {
  ref: string | null;
  sot_commit: string | null;
  docs: { created: number; updated: number; unchanged: number; residues: number; links: number };
  cards: { created: number; updated: number; unchanged: number; deleted: number };
  pointers: number;
  missing_embeddings: number;
  writes: number;
  errors: string[];
  exit_code: number;
};

export async function applyPlan(_dbPath: string, _plan: LoadPlan): Promise<ApplyResult> {
  throw new Error("import-sources write mode is not implemented yet; use --dry-run");
}
