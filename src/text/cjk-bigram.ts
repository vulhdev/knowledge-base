// CJK bigram tokenization shared by the FTS index (via the kb_cjk_bigram SQL function)
// and every FTS query, so index time and query time always split text the same way.

const CJK_CHAR = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆`;
const CJK_RUN = new RegExp(`[${CJK_CHAR}]+`, "gu");
const SCRIPT_RUN = new RegExp(`[${CJK_CHAR}]+|[^${CJK_CHAR}]+`, "gu");
const IS_CJK = new RegExp(`^[${CJK_CHAR}]`, "u");

function bigrams(run: string): string[] {
  const chars = Array.from(run);
  const out: string[] = [];
  for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
  return out;
}

/** Replace every CJK run of length >= 2 with its space-separated bigrams; everything else is unchanged. */
export function bigramIndexText(text: string | null | undefined): string {
  if (!text) return text ?? "";
  return text.replace(CJK_RUN, (run) => (Array.from(run).length < 2 ? run : ` ${bigrams(run).join(" ")} `));
}

/**
 * Build FTS5 MATCH tokens from a user query. Whitespace split as before; each token is then split
 * per script run. A CJK run of >= 2 chars becomes a phrase of its bigrams; a single CJK char is
 * dropped; any other run has FTS operator characters stripped and is kept when longer than 1 char.
 * Every token is a quoted phrase so punctuation such as "-" cannot break the MATCH syntax.
 */
export function buildFtsQuery(query: string): { tokens: string[] } {
  const tokens: string[] = [];
  for (const word of query.split(/\s+/)) {
    for (const run of word.match(SCRIPT_RUN) ?? []) {
      if (IS_CJK.test(run)) {
        if (Array.from(run).length < 2) continue;
        tokens.push(`"${bigrams(run).join(" ")}"`);
      } else {
        const cleaned = run.replace(/[*"^():]/g, "").trim();
        if (cleaned.length > 1) tokens.push(`"${cleaned}"`);
      }
    }
  }
  return { tokens };
}
