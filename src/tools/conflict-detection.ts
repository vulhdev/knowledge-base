import type Database from "better-sqlite3";
import type { ConflictResult } from "../types.js";
import { fetchFeatures } from "./_helpers.js";

export type RequestSampling = (prompt: string) => Promise<string>;

const SIMILARITY_THRESHOLD = 0.5;
const MAX_CANDIDATES = 3;

type Candidate = {
  id: number;
  features: string[];
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
    type RawRow = { id: number; type: string; body: string; distance: number };
    const rows = db
      .prepare(
        `
        SELECT c.id, c.type, c.body, v.distance
        FROM vec_contents v
        JOIN contents c ON v.rowid = c.id
        JOIN content_features cf ON cf.content_id = c.id
        JOIN features f ON cf.feature_id = f.id
        JOIN workspaces w ON f.workspace_id = w.id
        WHERE v.embedding MATCH ? AND k = ?
          AND w.name = ?
          AND c.id != ?
          AND v.distance < ?
        ORDER BY v.distance
        LIMIT ?
      `,
      )
      .all(embeddingBlob, MAX_CANDIDATES + 1, workspace, contentId, SIMILARITY_THRESHOLD, MAX_CANDIDATES) as RawRow[];

    return rows.map(({ id, type, body }) => ({ id, features: fetchFeatures(db, id), type, body }));
  } catch {
    return [];
  }
}

export function buildPrompt(
  workspace: string,
  features: string[],
  type: string,
  body: string,
  candidates: Candidate[],
): string {
  const existingDocs = candidates
    .map((c, i) => `[${i + 1}] id=${c.id}, features="${c.features.join(", ")}", type="${c.type}"\n${c.body}`)
    .join("\n\n");

  return `You are a technical document conflict detector. Compare the NEW document with each EXISTING document and identify conflicts.

A conflict exists when:
- Both documents make opposite decisions about the same topic (semantic_contradiction)
- One document raises risks/warnings about something the other document is doing (risk_shadow)

NEW DOCUMENT (workspace: "${workspace}", features: "${features.join(", ")}", type: "${type}"):
${body}

EXISTING DOCUMENTS:
${existingDocs}

Respond ONLY with a JSON array. If no conflicts, return [].
[
  { "content_id": <id>, "features": ["<feature>"], "type": "semantic_contradiction" | "risk_shadow", "reason": "<one sentence>" }
]`;
}

export function parseConflicts(raw: string, candidates: Candidate[]): ConflictResult[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    const validIds = new Set(candidates.map((c) => c.id));
    return parsed
      .filter(
        (x) =>
          typeof x.content_id === "number" &&
          validIds.has(x.content_id) &&
          Array.isArray(x.features) &&
          (x.type === "semantic_contradiction" || x.type === "risk_shadow") &&
          typeof x.reason === "string",
      )
      .map((x) => {
        const candidate = candidates.find((c) => c.id === x.content_id)!;
        return { content_id: x.content_id, features: candidate.features, type: x.type, reason: x.reason };
      });
  } catch {
    return [];
  }
}

export async function detectConflicts(
  db: Database.Database,
  contentId: number,
  workspace: string,
  features: string[],
  type: string,
  body: string,
  embeddingBlob: Buffer,
  requestSampling: RequestSampling,
): Promise<ConflictResult[]> {
  const candidates = findSimilarInWorkspace(db, contentId, workspace, embeddingBlob);
  if (candidates.length === 0) return [];

  try {
    const prompt = buildPrompt(workspace, features, type, body, candidates);
    const raw = await requestSampling(prompt);
    return parseConflicts(raw, candidates);
  } catch {
    return [];
  }
}
