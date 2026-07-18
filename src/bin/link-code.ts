#!/usr/bin/env node
import { execSync } from "node:child_process";
import { openDb } from "../db/client.js";
import { attachCodeRef } from "../tools/attach-code-ref.js";
import type { CodeRefFile } from "../types.js";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function gitHead(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    console.error("Error: not a git repository or git not found");
    process.exit(1);
  }
}

function gitChangedFiles(): CodeRefFile[] {
  try {
    const out = execSync("git diff-tree --no-commit-id -r --name-only HEAD", {
      encoding: "utf8",
    }).trim();
    if (!out) return [];
    return out.split("\n").map((p) => ({ path: p }));
  } catch {
    return [];
  }
}

function resolveContentId(
  db: ReturnType<typeof openDb>,
  workspace: string,
  feature: string,
): number {
  const row = db
    .prepare(
      `SELECT c.id FROM contents c
       JOIN features f ON c.feature_id = f.id
       JOIN workspaces w ON f.workspace_id = w.id
       WHERE w.name = ? AND f.name = ?
       ORDER BY c.updated_at DESC
       LIMIT 1`,
    )
    .get(workspace, feature) as { id: number } | undefined;

  if (!row) {
    console.error(`Error: no content found for workspace="${workspace}" feature="${feature}"`);
    process.exit(1);
  }
  return row.id;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args["task"]) {
    console.error("Error: --task is required");
    console.error(
      "Usage: knowledge-base link-code --workspace <name> --feature <name> --task <label>",
    );
    process.exit(1);
  }

  let contentId: number;
  if (args["content-id"]) {
    contentId = parseInt(args["content-id"], 10);
    if (isNaN(contentId)) {
      console.error("Error: --content-id must be a number");
      process.exit(1);
    }
  } else if (args["workspace"] && args["feature"]) {
    const db = openDb();
    contentId = resolveContentId(db, args["workspace"], args["feature"]);
  } else {
    console.error("Error: provide either --workspace and --feature, or --content-id");
    process.exit(1);
  }

  const commitHash = gitHead();
  const filePaths = gitChangedFiles();
  const taskRef = args["task"];

  const db = openDb();
  try {
    attachCodeRef(db, contentId, commitHash, filePaths, taskRef);
    const shortHash = commitHash.slice(0, 7);
    console.log(`✓ Linked commit ${shortHash} → plan #${contentId} (${taskRef})`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
