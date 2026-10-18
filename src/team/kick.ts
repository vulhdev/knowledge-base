import type Database from "better-sqlite3";

export type TeamManifest = {
  peers: { publicKey: string; displayName: string }[];
};

export function kickPeer(db: Database.Database, publicKey: string): void {
  const result = db
    .prepare("UPDATE team_peers SET is_active = 0 WHERE public_key = ?")
    .run(publicKey);
  if (result.changes === 0) {
    throw new Error(`Peer not found: ${publicKey}`);
  }
}

export function getTeamManifest(db: Database.Database): TeamManifest {
  const rows = db
    .prepare("SELECT public_key, display_name FROM team_peers WHERE is_active = 1")
    .all() as { public_key: string; display_name: string }[];
  return {
    peers: rows.map((r) => ({ publicKey: r.public_key, displayName: r.display_name })),
  };
}
