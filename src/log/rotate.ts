import { mkdirSync, existsSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOG_DIR } from "../config.js";

function getLogDir(): string {
  return process.env.KB_LOG_DIR ?? LOG_DIR;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getLogPath(): string {
  return join(getLogDir(), `${todayStr()}.log`);
}

export function initRotation(): void {
  try {
    const dir = getLogDir();
    const todayFile = getLogPath();

    if (existsSync(todayFile)) return;

    mkdirSync(dir, { recursive: true });

    // Delete .log files older than 7 days
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    try {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".log")) continue;
        const dateStr = file.slice(0, 10);
        if (dateStr < cutoffStr) {
          try { unlinkSync(join(dir, file)); } catch { /* ok */ }
        }
      }
    } catch { /* dir may be empty or unreadable */ }

    writeFileSync(todayFile, "");
  } catch { /* never throw */ }
}
