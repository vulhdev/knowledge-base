import type Database from "better-sqlite3";

export type WorkspaceTeamRow = {
  workspace_id: number;
  role: "host" | "peer";
  secret: string;
  noise_public_key: string;
  noise_secret_key: string;
  host_public_key: string | null;
  last_synced_at: string | null;
};

export type WorkspaceTeamWithName = WorkspaceTeamRow & { name: string };

export type WorkspaceInviteRow = {
  id: number;
  workspace_id: number;
  github_username: string;
  invited_at: string;
};

export function getTeamByName(
  db: Database.Database,
  workspaceName: string,
): WorkspaceTeamRow | null {
  return (
    db
      .prepare(
        `SELECT wt.* FROM workspace_team wt
         JOIN workspaces w ON w.id = wt.workspace_id
         WHERE w.name = ?`,
      )
      .get(workspaceName) as WorkspaceTeamRow | undefined
  ) ?? null;
}

export function listTeamWorkspaces(db: Database.Database): WorkspaceTeamWithName[] {
  return db
    .prepare(
      `SELECT w.name, wt.*
       FROM workspace_team wt
       JOIN workspaces w ON w.id = wt.workspace_id
       ORDER BY w.name ASC`,
    )
    .all() as WorkspaceTeamWithName[];
}

export function insertTeam(
  db: Database.Database,
  workspaceId: number,
  config: Omit<WorkspaceTeamRow, "workspace_id">,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO workspace_team
       (workspace_id, role, secret, noise_public_key, noise_secret_key, host_public_key, last_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    workspaceId,
    config.role,
    config.secret,
    config.noise_public_key,
    config.noise_secret_key,
    config.host_public_key ?? null,
    config.last_synced_at ?? null,
  );
}

export function updateTeamKeypair(
  db: Database.Database,
  workspaceId: number,
  publicKey: string,
  secretKey: string,
): void {
  db.prepare(
    "UPDATE workspace_team SET noise_public_key = ?, noise_secret_key = ? WHERE workspace_id = ?",
  ).run(publicKey, secretKey, workspaceId);
}

export function updateLastSynced(
  db: Database.Database,
  workspaceId: number,
  timestamp: string,
): void {
  db.prepare(
    "UPDATE workspace_team SET last_synced_at = ? WHERE workspace_id = ?",
  ).run(timestamp, workspaceId);
}

export function addInvite(
  db: Database.Database,
  workspaceId: number,
  githubUsername: string,
): void {
  db.prepare(
    `INSERT INTO workspace_invites (workspace_id, github_username)
     VALUES (?, ?)
     ON CONFLICT(workspace_id, github_username) DO UPDATE SET invited_at = datetime('now')`,
  ).run(workspaceId, githubUsername);
}

export function removeInvite(
  db: Database.Database,
  workspaceId: number,
  githubUsername: string,
): void {
  db.prepare(
    "DELETE FROM workspace_invites WHERE workspace_id = ? AND github_username = ?",
  ).run(workspaceId, githubUsername);
}

export function listInvites(
  db: Database.Database,
  workspaceId: number,
): WorkspaceInviteRow[] {
  return db
    .prepare(
      "SELECT * FROM workspace_invites WHERE workspace_id = ? ORDER BY invited_at ASC",
    )
    .all(workspaceId) as WorkspaceInviteRow[];
}
