#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LOG_DIR } from "../config.js";

const LEVEL_ORDER: Record<string, number> = { INFO: 0, WARN: 1, ERROR: 2 };

export function getLogDir(): string {
  return process.env.KB_LOG_DIR ?? LOG_DIR;
}

export function parseSince(s: string): Date {
  const relMatch = s.match(/^(\d+)(d|h|m)$/);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const unit = relMatch[2];
    const ms = unit === "d" ? n * 86400000 : unit === "h" ? n * 3600000 : n * 60000;
    return new Date(Date.now() - ms);
  }
  return new Date(s);
}

export function levelAtLeast(line: string, minLevel: string): boolean {
  const match = line.match(/\]\s+(\w+)\s+/);
  if (!match) return true;
  const lineLevel = match[1].trim();
  return (LEVEL_ORDER[lineLevel] ?? 0) >= (LEVEL_ORDER[minLevel] ?? 0);
}

export function afterSince(line: string, since: Date): boolean {
  const match = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
  if (!match) return true;
  return new Date(match[1].replace(" ", "T") + "Z") >= since;
}

export function filterLines(lines: string[], opts: { level?: string; since?: Date; tail?: number }): string[] {
  let result = lines;

  if (opts.since) {
    const since = opts.since;
    result = result.filter((l) => afterSince(l, since));
  }

  if (opts.level) {
    const minLevel = opts.level;
    result = result.filter((l) => levelAtLeast(l, minLevel));
  }

  if (opts.tail !== undefined) {
    result = result.slice(-opts.tail);
  }

  return result;
}

export function readLogLines(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".log"))
    .sort();

  const lines: string[] = [];
  for (const file of files) {
    const content = readFileSync(join(dir, file), "utf8");
    lines.push(...content.split("\n").filter((l) => l.trim()));
  }
  return lines;
}

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
