import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function readWorkspaceFromClaudeMd(cwd?: string): string | null {
  const dir = cwd ?? process.cwd();
  const path = join(dir, "CLAUDE.md");
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8");
    const match = /^KNOWLEDGE_BASE_WORKSPACE=(\S+)/m.exec(text);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
