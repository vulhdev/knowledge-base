import type Database from "better-sqlite3";
import type { ConflictResult } from "../types.js";

export type RequestSampling = (prompt: string) => Promise<string>;

const SIMILARITY_THRESHOLD = 0.5;
const MAX_CANDIDATES = 3;

type Candidate = {
  id: number;
  feature: string;
  type: string;
  body: string;
};

export function findSimilarInWorkspace(
  db: Database.Database,
  contentId: number,
  workspace: string,
  embeddingBlob: Buffer,
): Candidate[] {
  try {
    const rows = db
      .prepare(
        `
        SELECT c.id, f.name AS feature, c.type, c.body, v.distance
        FROM vec_contents v
        JOIN contents c ON v.rowid = c.id
        JOIN features f ON c.feature_id = f.id
        JOIN workspaces w ON f.workspace_id = w.id
        WHERE v.embedding MATCH ? AND k = ?
          AND w.name = ?
          AND c.id != ?
          AND v.distance < ?
        ORDER BY v.distance
        LIMIT ?
      `,
      )
      .all(embeddingBlob, MAX_CANDIDATES + 1, workspace, contentId, SIMILARITY_THRESHOLD, MAX_CANDIDATES) as (Candidate & {
      distance: number;
    })[];

    return rows.map(({ id, feature, type, body }) => ({ id, feature, type, body }));
  } catch {
    return [];
  }
}

export function buildPrompt(
  workspace: string,
  feature: string,
  type: string,
  body: string,
  candidates: Candidate[],
): string {
  const existingDocs = candidates
    .map((c, i) => `[${i + 1}] id=${c.id}, feature="${c.feature}", type="${c.type}"\n${c.body}`)
    .join("\n\n");

  return `You are a technical document conflict detector. Compare the NEW document with each EXISTING document and identify conflicts.

A conflict exists when:
- Both documents make opposite decisions about the same topic (semantic_contradiction)
- One document raises risks/warnings about something the other document is doing (risk_shadow)

NEW DOCUMENT (workspace: "${workspace}", feature: "${feature}", type: "${type}"):
${body}

EXISTING DOCUMENTS:
${existingDocs}

Respond ONLY with a JSON array. If no conflicts, return [].
[
  { "content_id": <id>, "feature": "<feature>", "type": "semantic_contradiction" | "risk_shadow", "reason": "<one sentence>" }
]`;
}

export function parseConflicts(raw: string, candidates: Candidate[]): ConflictResult[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    const validIds = new Set(candidates.map((c) => c.id));
    return parsed.filter(
      (x) =>
        typeof x.content_id === "number" &&
        validIds.has(x.content_id) &&
        typeof x.feature === "string" &&
        (x.type === "semantic_contradiction" || x.type === "risk_shadow") &&
        typeof x.reason === "string",
    );
  } catch {
    return [];
  }
}

export async function detectConflicts(
  db: Database.Database,
  contentId: number,
  workspace: string,
  feature: string,
  type: string,
  body: string,
  embeddingBlob: Buffer,
  requestSampling: RequestSampling,
): Promise<ConflictResult[]> {
  const candidates = findSimilarInWorkspace(db, contentId, workspace, embeddingBlob);
  if (candidates.length === 0) return [];

  try {
    const prompt = buildPrompt(workspace, feature, type, body, candidates);
    const raw = await requestSampling(prompt);
    return parseConflicts(raw, candidates);
  } catch {
    return [];
  }
}
