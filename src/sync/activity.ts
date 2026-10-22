import type Database from "better-sqlite3";
import type { ChangesetRow } from "./changeset.js";

export type ActivityLogger = {
  onPeerConnect: (workspace: string, username: string | null, publicKey: string) => void;
  onPeerDisconnect: (workspace: string, username: string | null, publicKey: string) => void;
  onChangesetReceived: (workspace: string, username: string | null, rows: ChangesetRow[], db: Database.Database) => void;
  onChangesetSent: (workspace: string, username: string | null, count: number) => void;
  onJoinConnect: (workspace: string, publicKey: string) => void;
  onJoinAttempt: (workspace: string, githubUsername: string) => void;
  onJoinResult: (workspace: string, githubUsername: string, accepted: boolean, reason?: string) => void;
};

// ANSI helpers
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dimCyan: "\x1b[2;36m",
};

function ts(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${c.dim}[${hh}:${mm}:${ss}]${c.reset}`;
}

function peer(username: string | null, publicKey: string): string {
  if (username) return `${c.bold}@${username}${c.reset}`;
  return `${c.dim}(key: ${publicKey.slice(0, 8)}…)${c.reset}`;
}

function ws(workspace: string): string {
  return `${c.dim}(${workspace})${c.reset}`;
}

type DocAction = { title: string; actions: string[] };

export function describeChangeset(rows: ChangesetRow[], db: Database.Database): DocAction[] {
  // Group rows by pk within the `contents` table
  const contentPks = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.tbl === "contents") {
      if (!contentPks.has(row.pk)) contentPks.set(row.pk, new Set());
      contentPks.get(row.pk)!.add(row.cid);
    }
  }

  const result: DocAction[] = [];

  for (const [pk, cids] of contentPks) {
    const actions: string[] = [];

    if (cids.has("__crsql_del")) {
      actions.push("deleted doc");
    } else {
      if (cids.has("title")) actions.push("edited title");
      if (cids.has("body")) actions.push("edited body");
      if (cids.has("type")) actions.push("edited type");
      // If only non-title/body columns changed (or first time we see this pk), label as new doc
      if (actions.length === 0) actions.push("new doc");
    }

    let title = `(id: ${pk})`;
    try {
      const row = db.prepare("SELECT title FROM contents WHERE id = ?").get(pk) as { title: string | null } | undefined;
      if (row?.title) title = `"${row.title}"`;
    } catch {
      // contents table may not exist yet during tests
    }

    result.push({ title, actions });
  }

  // Summarise non-contents tables
  const otherTbls = new Set(rows.filter((r) => r.tbl !== "contents").map((r) => r.tbl));
  for (const tbl of otherTbls) {
    if (tbl === "content_features") result.push({ title: "(feature)", actions: ["feature changed"] });
    else if (tbl === "content_links") result.push({ title: "(link)", actions: ["link added/removed"] });
    else result.push({ title: `(${tbl})`, actions: ["changed"] });
  }

  return result;
}

export function makeConsoleLogger(): ActivityLogger {
  return {
    onPeerConnect(workspace, username, publicKey) {
      console.log(`${ts()} ${c.green}●${c.reset} ${peer(username, publicKey)} connected          ${ws(workspace)}`);
    },

    onPeerDisconnect(workspace, username, publicKey) {
      console.log(`${ts()} ${c.dim}○${c.reset} ${peer(username, publicKey)} disconnected       ${ws(workspace)}`);
    },

    onChangesetReceived(workspace, username, rows, db) {
      const actions = describeChangeset(rows, db);
      const who = peer(username, "");
      console.log(`${ts()} ${c.cyan}←${c.reset} ${who} ${c.cyan}»${c.reset} ${rows.length} change${rows.length !== 1 ? "s" : ""}`);
      for (const { title, actions: acts } of actions) {
        console.log(`           ${c.dim}·${c.reset} ${c.bold}${title}${c.reset}  ${acts.join(", ")}`);
      }
    },

    onChangesetSent(workspace, username, count) {
      console.log(`${ts()} ${c.dimCyan}→${c.reset} sent ${count} change${count !== 1 ? "s" : ""} to ${peer(username, "")} ${ws(workspace)}`);
    },

    onJoinConnect(workspace, publicKey) {
      console.log(`${ts()} ${c.dim}↗${c.reset} join connection (key: ${publicKey.slice(0, 12)}…)      ${ws(workspace)}`);
    },

    onJoinAttempt(workspace, githubUsername) {
      console.log(`${ts()} ${c.yellow}↑${c.reset} ${c.bold}@${githubUsername}${c.reset} wants to join    ${ws(workspace)}`);
    },

    onJoinResult(workspace, githubUsername, accepted, reason) {
      if (accepted) {
        console.log(`${ts()} ${c.green}✓${c.reset} ${c.bold}@${githubUsername}${c.reset} joined               ${ws(workspace)}`);
      } else {
        console.log(`${ts()} ${c.red}✗${c.reset} ${c.bold}@${githubUsername}${c.reset} rejected: ${reason ?? "unknown"}  ${ws(workspace)}`);
      }
    },
  };
}
