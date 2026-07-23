import type Database from "better-sqlite3";

export interface ErrorLog {
  id: number;
  timestamp: string;
  tool_name: string;
  message: string;
  severity: string;
}

export function insertErrorLog(
  db: Database.Database,
  toolName: string,
  message: string,
  severity: "error" | "warning" = "error",
): void {
  try {
    db.prepare("INSERT INTO error_logs (tool_name, message, severity) VALUES (?, ?, ?)").run(toolName, message, severity);
    pruneErrorLogs(db);
  } catch {
    console.error(`[error-log] ${toolName}: ${message}`);
  }
}

export function listErrorLogs(db: Database.Database): ErrorLog[] {
  return db
    .prepare("SELECT * FROM error_logs ORDER BY id DESC")
    .all() as ErrorLog[];
}

function pruneErrorLogs(db: Database.Database): void {
  db.prepare(
    "DELETE FROM error_logs WHERE id NOT IN (SELECT id FROM error_logs ORDER BY id DESC LIMIT 1000)",
  ).run();
}
