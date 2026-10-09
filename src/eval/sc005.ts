// SC-005: the test DB must hold no SOT content. Every string of >= 20 characters stored in any
// ordinary table is compared with the SOT files at their card commits; heading lines and paths
// are allowed (they are the outline the cards are made of).
import type Database from "better-sqlite3";

export const WINDOW = 20;

export type Sc005Match = { table: string; column: string; rowid: number; sample: string };

/** A window that carries no letters (only punctuation, digits, spaces, table rules) is not content. */
function informative(w: string): boolean {
  return /[\p{L}]/u.test(w) && new Set(w).size > 4;
}

export function sotWindows(texts: string[], paths: string[]): Set<string> {
  const set = new Set<string>();
  for (const text of texts) {
    for (const line of text.split("\n")) {
      if (/^\s{0,3}#{1,6}\s/.test(line)) continue; // heading text is allowed in cards
      const chars = Array.from(line);
      for (let i = 0; i + WINDOW <= chars.length; i++) {
        const w = chars.slice(i, i + WINDOW).join("");
        if (informative(w) && !paths.some((p) => p.includes(w))) set.add(w);
      }
    }
  }
  return set;
}

export function scanDb(db: Database.Database, windows: Set<string>, opts: { skipRowsWhere?: string } = {}): Sc005Match[] {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND sql NOT LIKE 'CREATE VIRTUAL%' AND name NOT LIKE 'sqlite_%'
              AND name NOT LIKE '%_fts_%' AND name NOT LIKE 'vec_%'`)
    .all() as { name: string }[];
  const matches: Sc005Match[] = [];
  for (const { name } of tables) {
    const cols = (db.prepare(`SELECT name, type FROM pragma_table_info(?)`).all(name) as { name: string; type: string }[])
      .filter((c) => c.type.toUpperCase() === "TEXT" || c.type === "");
    for (const c of cols) {
      const where = name === "contents" && opts.skipRowsWhere ? ` WHERE NOT (${opts.skipRowsWhere})` : "";
      const rows = db.prepare(`SELECT rowid AS rowid, "${c.name}" AS v FROM "${name}"${where}`).all() as { rowid: number; v: unknown }[];
      for (const r of rows) {
        if (typeof r.v !== "string" || r.v.length < WINDOW) continue;
        const chars = Array.from(r.v);
        for (let i = 0; i + WINDOW <= chars.length; i++) {
          const w = chars.slice(i, i + WINDOW).join("");
          if (windows.has(w)) {
            matches.push({ table: name, column: c.name, rowid: r.rowid, sample: w });
            break;
          }
        }
      }
    }
  }
  return matches;
}
