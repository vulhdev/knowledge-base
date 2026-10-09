// Token counter for the section chunker. Uses the embedding model's own tokenizer when the model
// is in the local cache (never downloads); otherwise a deterministic approximation.
import { isModelReady } from "./model.js";
import { loadSettings } from "../config.js";

const MODEL_NAME = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆]/u;

export type TokenCounter = (text: string) => number;

/** One token per CJK character, ceil(len / 4) per other whitespace-separated word. */
export const approxTokenCount: TokenCounter = (text) => {
  let total = 0;
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    let latin = 0;
    for (const ch of word) {
      if (CJK.test(ch)) total += 1;
      else latin += 1;
    }
    if (latin > 0) total += Math.ceil(latin / 4);
  }
  return total;
};

let real: TokenCounter | null = null;

export async function getTokenCounter(): Promise<TokenCounter> {
  if (real) return real;
  if (!isModelReady()) return approxTokenCount;
  try {
    const { AutoTokenizer, env } = await import("@huggingface/transformers");
    // Same cache location model.ts uses. Passing cache_dir per call instead resolves a different
    // layout, falls through to a remote metadata fetch and leaves the shared pipeline unusable.
    env.cacheDir = loadSettings().model_cache_dir;
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_NAME, { local_files_only: true });
    real = (text: string) => tokenizer.encode(text, { add_special_tokens: false }).length;
    return real;
  } catch {
    // tokenizer failure must not block writes — fall back to the approximation
    return approxTokenCount;
  }
}
