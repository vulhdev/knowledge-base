import type Database from "better-sqlite3";

export type Member = {
  github_login: string;
  workspace: string;
  role: string;
  invited_by: string | null;
  created_at: string;
};

export function addMember(
  db: Database.Database,
  github_login: string,
  workspace: string,
  invited_by?: string
): void {
  const ws = db
    .prepare("SELECT id FROM workspaces WHERE name = ?")
    .get(workspace) as { id: number } | undefined;

  if (!ws) {
    db.prepare("INSERT INTO workspaces (name) VALUES (?)").run(workspace);
  }

  const wsId = (
    db.prepare("SELECT id FROM workspaces WHERE name = ?").get(workspace) as { id: number }
  ).id;

  db.prepare(
    "INSERT OR IGNORE INTO members (github_login, workspace_id, invited_by) VALUES (?, ?, ?)"
  ).run(github_login, wsId, invited_by ?? null);
}

export function removeMember(
  db: Database.Database,
  github_login: string,
  workspace: string
): void {
  const ws = db
    .prepare("SELECT id FROM workspaces WHERE name = ?")
    .get(workspace) as { id: number } | undefined;

  if (!ws) return;

  db.prepare(
    "DELETE FROM members WHERE github_login = ? AND workspace_id = ?"
  ).run(github_login, ws.id);
}

export function listMembers(db: Database.Database, workspace: string): Member[] {
  const ws = db
    .prepare("SELECT id FROM workspaces WHERE name = ?")
    .get(workspace) as { id: number } | undefined;

  if (!ws) return [];

  return db
    .prepare(
      `SELECT m.github_login, w.name AS workspace, m.role, m.invited_by, m.created_at
       FROM members m
       JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.workspace_id = ?
       ORDER BY m.created_at`
    )
    .all(ws.id) as Member[];
}

export function isMember(
  db: Database.Database,
  github_login: string,
  workspace: string
): boolean {
  const ws = db
    .prepare("SELECT id FROM workspaces WHERE name = ?")
    .get(workspace) as { id: number } | undefined;

  if (!ws) return false;

  const row = db
    .prepare("SELECT 1 FROM members WHERE github_login = ? AND workspace_id = ?")
    .get(github_login, ws.id);

  return row !== undefined;
}
