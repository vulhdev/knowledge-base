#!/usr/bin/env node
import { existsSync } from "node:fs";
import { getLogDir, readLogLines, filterLines, parseSince } from "../log/reader.js";

function parseArgs(argv: string[]): { level: string | null; since: Date | null; tail: number | null } {
  let level: string | null = null;
  let since: Date | null = null;
  let tail: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--level" && argv[i + 1]) {
      level = argv[++i].toUpperCase();
    } else if (arg === "--since" && argv[i + 1]) {
      since = parseSince(argv[++i]);
    } else if (arg === "--tail" && argv[i + 1]) {
      tail = parseInt(argv[++i], 10);
    }
  }

  return { level, since, tail };
}

export function main(): void {
  const args = parseArgs(process.argv.slice(3));
  const dir = getLogDir();
  const allLines = readLogLines(dir);

  if (allLines.length === 0) {
    console.log(existsSync(dir) ? "No log files found." : "No logs found. Run some knowledge-base commands first.");
    return;
  }

  const lines = filterLines(allLines, {
    level: args.level ?? undefined,
    since: args.since ?? undefined,
    tail: args.tail ?? undefined,
  });

  if (lines.length === 0) {
    console.log("No log entries match the given filters.");
    return;
  }

  for (const line of lines) {
    process.stdout.write(line + "\n");
  }
}

main();
