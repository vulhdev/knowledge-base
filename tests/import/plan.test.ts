import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { buildLoadPlan, buildCardBody, type PlanCard } from "../../src/import/plan.js";
import { scanSources } from "../../src/import/scan.js";
import { outlineMarkdown } from "../../src/text/chunker.js";
import { makeRepo, type Repo } from "./git-fixture.js";

let repo: Repo | null = null;
afterEach(() => { repo?.cleanup(); repo = null; });

const SOT = [
  "# F-001 見積の流れ",
  "",
  "見積金額は原価に掛率を乗じて算出する。端数処理は切り捨てとする。",
  "## 掛率の決め方",
  "掛率は事業体ごとのマスタから引き当てる。上書きした値は確定時に凍結する。",
  "### 例外",
  "マスタに無い場合は既定値の一・〇を用いる。",
].join("\n") + "\n";

describe("buildCardBody", () => {
  it("holds path, ref, commit, sha, read command, outline with line ranges and history — no content sentence", () => {
    const body = buildCardBody({
      repoRoot: "/r", repoPath: "docs/F-001-x.md", ref: "origin/dev", commit: "c".repeat(40), sha: "s".repeat(64),
      text: SOT, history: [{ hash: "c".repeat(40), date: "2026-10-09T13:39:59+09:00" }],
    });
    expect(body).toContain("`docs/F-001-x.md`");
    expect(body).toContain("origin/dev");
    expect(body).toContain(`git -C /r show ${"c".repeat(40)}:docs/F-001-x.md`);
    expect(body).toContain("- L1–L7 1 F-001 見積の流れ");
    expect(body).toContain("- L4–L7 1.1 掛率の決め方");
    expect(body).toContain("- L6–L7 1.1.1 例外");
    expect(body.trimEnd().endsWith(`- ${"c".repeat(40)} 2026-10-09T13:39:59+09:00`)).toBe(true);
    for (const line of SOT.split("\n").filter((l) => l && !l.startsWith("#"))) {
      expect(body).not.toContain(line.slice(0, 20));
    }
  });

  it("outline keys match the heading tree", () => {
    expect(outlineMarkdown(SOT).map((e) => e.key)).toEqual(["1", "1.1", "1.1.1"]);
  });
});

describe("buildLoadPlan", () => {
  it("emits docs, fork residue + link, series link and cards from git", () => {
    repo = makeRepo();
    repo.write(".gitignore", ".claude/claude\nclone2\n");
    repo.write("sot/F-001-x.md", SOT);
    const c = repo.commit("sot");
    repo.write(".claude/claude/docs/p/a.md", "# A\nshared\nonly-one\n");
    repo.write(".claude/claude/docs/p/n.md", "# N\n");
    repo.write(".claude/claude/docs/p/n-20260101.md", "# N dated\n");
    repo.write("clone2/.claude/claude/docs/p/a.md", "# A\nshared\nonly-two\n");

    const scan = scanSources([join(repo.dir, ".claude/claude/docs/p"), join(repo.dir, "clone2/.claude/claude/docs/p"), join(repo.dir, "sot")]);
    const plan = buildLoadPlan(scan, "ws", "ws-sot");
    const keys = plan.items.map((i) => i.source_key).sort();
    expect(keys).toEqual([
      "doc:ws:docs/p/a.md",
      "doc:ws:docs/p/a.md#fork-residue",
      "doc:ws:docs/p/n-20260101.md",
      "doc:ws:docs/p/n.md",
      expect.stringMatching(/^sot:ws-sot:[0-9a-f]{12}\/sot\/F-001-x\.md$/),
    ]);
    expect(plan.links).toEqual(expect.arrayContaining([
      { parent_source_key: "doc:ws:docs/p/a.md", child_source_key: "doc:ws:docs/p/a.md#fork-residue", reason: "fork-residue" },
      { parent_source_key: "doc:ws:docs/p/n.md", child_source_key: "doc:ws:docs/p/n-20260101.md", reason: "series" },
    ]));
    const card = plan.items.find((i) => i.kind === "card") as PlanCard;
    expect(card).toMatchObject({ workspace: "ws-sot", type: "sot-spec", commit: c, repo_path: "sot/F-001-x.md", markdown: true });
    expect(card.body).not.toContain("原価に掛率を乗じて");
    const residue = plan.items.find((i) => i.kind === "residue")!;
    expect(residue.type).toBe("fork-residue");
    expect(plan.stats).toMatchObject({ docs: 3, residues: 1, cards: 1, series_links: 1 });
  });
});
