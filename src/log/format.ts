export type LogLevel = "INFO" | "WARN" | "ERROR";

export function formatLogLine(
  level: LogLevel,
  source: string,
  fields: Record<string, string>,
): string {
  const now = new Date();
  const ts = now.toISOString().replace("T", " ").slice(0, 19);
  const levelPad = level.padEnd(5);

  const entries = Object.entries(fields);
  const eventEntry = entries.find(([k]) => k === "event");
  const rest = entries.filter(([k]) => k !== "event");
  const ordered = eventEntry ? [eventEntry, ...rest] : rest;

  const kv = ordered.map(([k, v]) => `${k}=${v}`).join(" ");
  const line = `[${ts}] ${levelPad} ${source}${kv ? " " + kv : ""}`;
  return line;
}
