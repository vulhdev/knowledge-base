import type Database from "better-sqlite3";

export type TeamManifest = {
  peers: { publicKey: string; displayName: string }[];
};

export type PeerRow = {
  public_key: string;
  display_name: string;
  github_username: string | null;
  is_active: number;
  joined_at: string;
  last_seen_at: string | null;
};

export function kickPeer(db: Database.Database, publicKey: string): void {
  const result = db
    .prepare("UPDATE team_peers SET is_active = 0 WHERE public_key = ?")
    .run(publicKey);
  if (result.changes === 0) {
    throw new Error(`Peer not found: ${publicKey}`);
  }
}

export function listPeers(db: Database.Database): PeerRow[] {
  return db
    .prepare("SELECT public_key, display_name, github_username, is_active, joined_at, last_seen_at FROM team_peers ORDER BY joined_at ASC")
    .all() as PeerRow[];
}

export function findPeerByUsername(
  db: Database.Database,
  githubUsername: string,
): { public_key: string; is_active: number } | undefined {
  return db
    .prepare("SELECT public_key, is_active FROM team_peers WHERE github_username = ?")
    .get(githubUsername) as { public_key: string; is_active: number } | undefined;
}

export function deletePeer(db: Database.Database, publicKey: string): void {
  const row = db
    .prepare("SELECT is_active FROM team_peers WHERE public_key = ?")
    .get(publicKey) as { is_active: number } | undefined;
  if (!row) throw new Error("Member not found.");
  if (row.is_active === 1) throw new Error("Kick the member first before deleting.");
  db.prepare("DELETE FROM team_peers WHERE public_key = ?").run(publicKey);
}

export function getTeamManifest(db: Database.Database): TeamManifest {
  const rows = db
    .prepare("SELECT public_key, display_name FROM team_peers WHERE is_active = 1")
    .all() as { public_key: string; display_name: string }[];
  return {
    peers: rows.map((r) => ({ publicKey: r.public_key, displayName: r.display_name })),
  };
}
