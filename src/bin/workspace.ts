#!/usr/bin/env node
import * as p from "@clack/prompts";
import { openDb } from "../db/client.js";
import { mergeWorkspace } from "../sync/merge.js";
import { logInfo, logWarn } from "../log/logger.js";

const [, , , subcommand, ...args] = process.argv;

if (subcommand === "merge") {
  await runMerge(args);
} else {
  console.error(`Unknown workspace subcommand: ${subcommand ?? "(none)"}`);
  console.error("Usage: knowledge-base workspace merge <src> --into <dst>");
  process.exit(1);
}

async function runMerge(args: string[]): Promise<void> {
  const src = args.find((a) => !a.startsWith("--"));
  const intoIdx = args.indexOf("--into");
  const dst = intoIdx !== -1 ? args[intoIdx + 1] : undefined;

  if (!src || !dst) {
    console.error("Error: both <src> and --into <dst> are required");
    console.error("Usage: knowledge-base workspace merge <src> --into <dst>");
    process.exit(1);
  }

  p.intro(`Merging workspace "${src}" into "${dst}"`);

  const db = openDb();
  logInfo("workspace_merge", { event: "start", src, dst });
  let result;
  try {
    result = mergeWorkspace(db, src, dst);
  } catch (err) {
    p.log.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  }

  if (result.featuresMoved === 0) {
    p.log.info(`"${src}" has no features — nothing to merge.`);
  } else {
    p.log.success(`Moved ${result.featuresMoved} feature(s) into "${dst}".`);
    if (result.featuresRenamed.length > 0) {
      logWarn("workspace_merge", { event: "features_renamed", count: String(result.featuresRenamed.length) });
      p.log.warn(
        `${result.featuresRenamed.length} feature(s) renamed to avoid collisions:\n` +
        result.featuresRenamed.map((n) => `  "${n}" → "${n} [${src}]"`).join("\n"),
      );
    }
  }
  logInfo("workspace_merge", { event: "done", src, dst, features_moved: String(result.featuresMoved) });

  p.log.info(`Workspace "${src}" is now empty. Update KNOWLEDGE_BASE_WORKSPACE=${dst} in your CLAUDE.md.`);
  p.outro("Done.");
}
