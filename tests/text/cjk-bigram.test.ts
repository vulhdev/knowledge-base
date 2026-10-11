import { describe, it, expect } from "vitest";
import { bigramIndexText, buildFtsQuery } from "../../src/text/cjk-bigram.js";

describe("bigramIndexText", () => {
  it("splits a CJK run into adjacent bigrams", () => {
    expect(bigramIndexText("端数処理").trim().split(/\s+/)).toEqual(["端数", "数処", "処理"]);
  });

  it("keeps Latin, Vietnamese and numbers byte-for-byte", () => {
    expect(bigramIndexText("OAuth2 login Tiếng Việt 2026")).toBe("OAuth2 login Tiếng Việt 2026");
  });

  it("keeps a single CJK character as is", () => {
    expect(bigramIndexText("a 見 b")).toBe("a 見 b");
  });

  it("tokenizes a mixed sentence per script", () => {
    const out = bigramIndexText("見積金額は原価に掛率を乗じる。F-002");
    const tokens = out.trim().split(/\s+/);
    expect(tokens).toContain("掛率");
    expect(tokens).toContain("原価");
    expect(out).toContain("F-002");
    expect(tokens).not.toContain("見積金額は原価に掛率を乗じる");
  });

  it("treats the prolonged sound mark and iteration marks as CJK", () => {
    expect(bigramIndexText("データ").trim().split(/\s+/)).toEqual(["デー", "ータ"]);
    expect(bigramIndexText("人々").trim()).toBe("人々");
  });

  it("returns empty input unchanged", () => {
    expect(bigramIndexText("")).toBe("");
  });
});

describe("buildFtsQuery", () => {
  it("wraps a two-character term as a one-bigram phrase", () => {
    expect(buildFtsQuery("掛率").tokens).toEqual(['"掛率"']);
  });

  it("wraps a longer CJK run as a phrase of bigrams so non-adjacent pairs never match", () => {
    expect(buildFtsQuery("原価に掛率").tokens).toEqual(['"原価 価に に掛 掛率"']);
  });

  it("handles each script of a mixed query separately", () => {
    expect(buildFtsQuery("F-002 掛率").tokens).toEqual(['"F-002"', '"掛率"']);
  });

  it("splits a token that mixes scripts into one part per script run", () => {
    expect(buildFtsQuery("F-002の掛率").tokens).toEqual(['"F-002"', '"の掛 掛率"']);
  });

  it("drops a single CJK character", () => {
    expect(buildFtsQuery("見").tokens).toEqual([]);
  });

  it("strips FTS operator characters as before and drops one-letter tokens", () => {
    expect(buildFtsQuery('auth* "x" ^(OAuth2):').tokens).toEqual(['"auth"', '"OAuth2"']);
  });

  it("keeps the old whitespace split for Latin words", () => {
    expect(buildFtsQuery("OAuth2 authentication").tokens).toEqual(['"OAuth2"', '"authentication"']);
  });
});
