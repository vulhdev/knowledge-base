import { describe, it, expect } from "vitest";
import { createTestDb } from "../setup.js";
import { sotWindows, scanDb } from "../../src/eval/sc005.js";

describe("SC-005 scan", () => {
  const sot = ["# 見出しは許可される長いタイトルの行です", "見積金額は原価に掛率を乗じて算出する。端数処理は切り捨てとする。", "| --- | --- | --- | --- | --- |"];
  it("finds a 20-char SOT sentence fragment in any text column, ignores headings, paths and symbol-only windows", () => {
    const db = createTestDb();
    const w = sotWindows([sot.join("\n")], ["docs/design/business-design/F-002-genka-kentosho.md"]);
    db.prepare("INSERT INTO contents (type, title, body) VALUES ('x', ?, ?)").run("見出しは許可される長いタイトルの行です", "| --- | --- | --- | --- | --- |");
    expect(scanDb(db, w)).toEqual([]);
    db.prepare("INSERT INTO contents (type, title, body) VALUES ('x', 't', ?)").run("leak: 原価に掛率を乗じて算出する。端数処理は切り捨てとする。");
    const m = scanDb(db, w);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ table: "contents", column: "body" });
  });
});
