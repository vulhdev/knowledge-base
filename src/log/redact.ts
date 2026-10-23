import { homedir } from "node:os";

const HOME = homedir();

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value);
}

export function redactFields(fields: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] = redactValue(key, value);
  }
  return result;
}

function redactValue(key: string, value: unknown): string {
  if (key === "body") {
    const str = stringify(value);
    return `[body redacted, ${str.length} chars]`;
  }

  if (key === "embedding") return "[redacted]";
  if (key === "secret") return "[redacted]";
  if (key === "noise_public_key" || key === "noise_secret_key") return "[key redacted]";
  if (key.includes("token")) return "[token redacted]";

  const str = stringify(value);

  if (key === "host_public_key" || key === "publicKey" || key === "pub_key") {
    if (/^[0-9a-f]{64}$/i.test(str)) {
      return str.slice(0, 12) + "…";
    }
  }

  if (str.startsWith(HOME + "/") || str === HOME) {
    return "~" + str.slice(HOME.length);
  }

  if (key === "query") {
    return str.length > 60 ? str.slice(0, 60) + "…" : str;
  }

  if (str.length > 64) {
    return str.slice(0, 12) + "…[redacted]";
  }

  return str;
}
