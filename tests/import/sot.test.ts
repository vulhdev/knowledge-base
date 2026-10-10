import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";
import { makeRepo, type Repo } from "./git-fixture.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(true),
  getEmbedding: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
}));

import { scanSources } from "../../src/import/scan.js";
import { buildLoadPlan, type PlanCard } from "../../src/import/plan.js";
import { importSotCard, removeMissingSotFiles } from "../../src/import/sot.js";
import { getEmbedding, isModelReady } from "../../src/embedding/model.js";

const F1 = [
  "# F-001 見積の流れ",
  "",
  "見積金額は原価に掛率を乗じて算出する。端数処理は切り捨てとする。".repeat(3),
  "## 掛率の決め方",
  "掛率は事業体ごとのマスタから引き当てる。上書きした値は確定時に凍結する。".repeat(3),
  "## 回次",
  "回次は案件と取引先の組で通算する連番である。上限は十回とする。".repeat(3),
].join("\n") + "\n";
const CONF = Array.from({ length: 40 }, (_, i) => `F-${String(i).padStart(3, "0")}|docs/x-${i}.md|docs/x-${i}-status.md|src/a/${i}`).join("\n") + "\n";

let repo: Repo;
let db: Database.Database;
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

function cards(ref?: string): PlanCard[] {
  return buildLoadPlan(scanSources([join(repo.dir, "sot")], { ref }), "ws", "ws-sot").items.filter((i): i is PlanCard => i.kind === "card");
}
function plan(ref?: string) {
  return buildLoadPlan(scanSources([join(repo.dir, "sot")], { ref }), "ws", "ws-sot");
}
const pointers = (id: number) =>
  db.prepare("SELECT id, chunk_key, start_line, end_line, source_path, source_commit, chunk_sha, embedding IS NOT NULL AS has FROM content_chunks WHERE content_id = ? AND kind = 'sot' ORDER BY ord").all(id) as
    { id: number; chunk_key: string; start_line: number; end_line: number; source_path: string; source_commit: string; chunk_sha: string; has: number }[];
const changes = () => (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;

beforeEach(() => {
  vi.mocked(isModelReady).mockReturnValue(true);
  vi.mocked(getEmbedding).mockReset().mockResolvedValue(new Float32Array(384).fill(0.1));
  repo = makeRepo();
  repo.write("sot/F-001-flow.md", F1);
  repo.write("sot/registry.conf", CONF);
  repo.commit("sot");
  db = createTestDb();
});
afterEach(() => repo.cleanup());

describe("importSotCard", () => {
  it("creates one card with pointers whose git slices hash to chunk_sha (pointer-ok)", async () => {
    for (const c of cards()) await importSotCard(db, c);
    const rows = db.prepare("SELECT id, source_key, type FROM contents ORDER BY id").all() as { id: number; source_key: string; type: string }[];
    expect(rows.map((r) => r.source_key.replace(/^sot:ws-sot:[0-9a-f]{12}\//, ""))).toEqual(["sot/F-001-flow.md", "sot/registry.conf"]);
    for (const r of rows) {
      const ps = pointers(r.id);
      expect(ps.length).toBeGreaterThan(0);
      for (const p of ps) {
        const text = repo.git("show", `${p.source_commit}:${p.source_path}`);
        expect(sha(text.split("\n").slice(p.start_line - 1, p.end_line).join("\n"))).toBe(p.chunk_sha);
        expect(p.has).toBe(1);
      }
    }
    expect(pointers(rows[1].id).map((p) => p.chunk_key)[0]).toBe("0");
    expect((db.prepare("SELECT count(*) AS n FROM content_chunks WHERE kind = 'doc'").get() as { n: number }).n).toBe(0);
  });

  it("indexes pointer tokens contentlessly: JP terms match, column values read back NULL", async () => {
    for (const c of cards()) await importSotCard(db, c);
    const hits = db.prepare("SELECT rowid FROM sot_chunks_fts WHERE sot_chunks_fts MATCH ?").all('"掛率"') as unknown[];
    expect(hits.length).toBeGreaterThan(0);
    const any = db.prepare("SELECT heading, body FROM sot_chunks_fts LIMIT 1").get();
    expect(any).toEqual({ heading: null, body: null });
  });

  it("stores no 20-character fragment of the SOT text anywhere except heading text and paths", async () => {
    for (const c of cards()) await importSotCard(db, c);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql NOT LIKE 'CREATE VIRTUAL%' AND name NOT LIKE '%_fts_%' AND name NOT LIKE 'vec_%' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
    const sotLines = F1.split("\n").filter((l) => l && !l.startsWith("#"));
    for (const t of tables) {
      const cols = (db.prepare("SELECT name, type FROM pragma_table_info(?)").all(t) as { name: string; type: string }[]).filter((c) => c.type === "TEXT");
      for (const c of cols) {
        for (const r of db.prepare(`SELECT "${c.name}" AS v FROM "${t}"`).all() as { v: string | null }[]) {
          for (const line of sotLines) expect(String(r.v ?? "")).not.toContain(Array.from(line).slice(0, 20).join(""));
        }
      }
    }
  });

  it("reads from the ref, not the working tree", async () => {
    repo.write("sot/F-001-flow.md", F1.replace("上限は十回", "ローカル編集"));
    for (const c of cards()) await importSotCard(db, c);
    const body = (db.prepare("SELECT body FROM contents WHERE source_key LIKE '%F-001%'").get() as { body: string }).body;
    expect(body).toContain(`sha256: \`${sha(F1)}\``);
  });

  it("is a no-op when the file is unchanged, and replaces only that card's pointers when it changes", async () => {
    for (const c of cards()) await importSotCard(db, c);
    const before = changes();
    for (const c of cards()) expect((await importSotCard(db, c)).status).toBe("unchanged");
    expect(changes()).toBe(before);

    const confId = (db.prepare("SELECT id FROM contents WHERE source_key LIKE '%registry.conf'").get() as { id: number }).id;
    const confPointers = pointers(confId).map((p) => p.id);
    const f1Id = (db.prepare("SELECT id FROM contents WHERE source_key LIKE '%F-001%'").get() as { id: number }).id;
    const oldIds = pointers(f1Id).map((p) => p.id);

    repo.write("sot/F-001-flow.md", F1 + "## 追加\n" + "新しい節の本文である。".repeat(8) + "\n");
    const c2 = repo.commit("edit");
    const out = [] as string[];
    for (const c of cards()) out.push((await importSotCard(db, c)).status);
    expect(out.sort()).toEqual(["unchanged", "updated"]);
    const now = pointers(f1Id);
    expect(now.every((p) => p.source_commit === c2)).toBe(true);
    expect(now.some((p) => oldIds.includes(p.id))).toBe(false);
    expect(pointers(confId).map((p) => p.id)).toEqual(confPointers);
    expect((db.prepare("SELECT count(*) AS n FROM vec_chunks").get() as { n: number }).n).toBe(
      (db.prepare("SELECT count(*) AS n FROM content_chunks").get() as { n: number }).n,
    );
  });

  it("removes the card and its pointers when the file disappears from the ref", async () => {
    const p1 = plan();
    for (const c of p1.items as PlanCard[]) await importSotCard(db, c);
    repo.git("rm", "-q", "sot/registry.conf");
    repo.commit("rm");
    const p2 = plan();
    for (const c of p2.items as PlanCard[]) await importSotCard(db, c);
    const removed = removeMissingSotFiles(db, p2.sot_scopes, new Set(p2.items.map((i) => i.source_key)));
    expect(removed).toBe(1);
    expect((db.prepare("SELECT count(*) AS n FROM contents").get() as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT count(*) AS n FROM sot_chunks_fts WHERE sot_chunks_fts MATCH 'docs'").get() as { n: number }).n).toBe(0);
  });

  it("an embedding failure stores NULL vectors; a re-run fills them without rewriting the card", async () => {
    vi.mocked(getEmbedding).mockRejectedValue(new Error("down"));
    for (const c of cards()) await importSotCard(db, c);
    expect((db.prepare("SELECT count(*) AS n FROM content_chunks WHERE embedding IS NULL").get() as { n: number }).n).toBeGreaterThan(0);
    vi.mocked(getEmbedding).mockReset().mockResolvedValue(new Float32Array(384).fill(0.1));
    const updated = (db.prepare("SELECT max(updated_at) AS u FROM contents").get() as { u: string }).u;
    for (const c of cards()) expect((await importSotCard(db, c)).status).toBe("unchanged");
    expect((db.prepare("SELECT count(*) AS n FROM content_chunks WHERE embedding IS NULL").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT max(updated_at) AS u FROM contents").get() as { u: string }).u).toBe(updated);
  });

  it("a ref that cannot be read fails that file without writing a half card", async () => {
    const c = cards()[0];
    await expect(importSotCard(db, { ...c, commit: "0".repeat(40) })).rejects.toThrow(/git show/);
    expect((db.prepare("SELECT count(*) AS n FROM contents").get() as { n: number }).n).toBe(0);
    expect(db.inTransaction).toBe(false);
  });
});
