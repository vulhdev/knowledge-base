import { appendFileSync } from "node:fs";
import { formatLogLine, type LogLevel } from "./format.js";
import { redactFields } from "./redact.js";
import { getLogPath, initRotation } from "./rotate.js";

let initialized = false;

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  initRotation();
}

function write(level: LogLevel, source: string, fields: Record<string, unknown>): void {
  try {
    ensureInit();
    const redacted = redactFields(fields);
    const line = formatLogLine(level, source, redacted);
    appendFileSync(getLogPath(), line + "\n");
  } catch { /* never throw */ }
}

export function logInfo(source: string, fields: Record<string, unknown>): void {
  write("INFO", source, fields);
}

export function logWarn(source: string, fields: Record<string, unknown>): void {
  write("WARN", source, fields);
}

export function logError(source: string, err: unknown): void {
  try {
    ensureInit();
    const message = err instanceof Error ? err.message : String(err);
    const redacted = redactFields({ error: message });
    const line = formatLogLine("ERROR", source, redacted);
    let output = line + "\n";
    if (err instanceof Error && err.stack) {
      const stackLines = err.stack.split("\n").slice(1); // skip "Error: message" first line
      output += stackLines.map((l) => "    " + l.trim()).join("\n") + "\n";
    }
    appendFileSync(getLogPath(), output);
  } catch { /* never throw */ }
}
