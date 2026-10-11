// Global test setup: section chunking must never load the real model tokenizer (or read the
// user's settings) in tests. Files that test the tokenizer itself call vi.unmock.
import { vi } from "vitest";

vi.mock("../src/embedding/tokenizer.js", async () => {
  const approx = (text: string) => {
    let total = 0;
    for (const word of text.split(/\s+/)) {
      if (!word) continue;
      let latin = 0;
      for (const ch of word) {
        if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆]/u.test(ch)) total += 1;
        else latin += 1;
      }
      if (latin > 0) total += Math.ceil(latin / 4);
    }
    return total;
  };
  return { approxTokenCount: approx, getTokenCounter: async () => approx };
});
