import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../setup.js";
import type Database from "better-sqlite3";

function seedPeer(db: Database.Database, publicKey: string, displayName: string): void {
  db.prepare("INSERT INTO team_peers (public_key, display_name) VALUES (?, ?)").run(publicKey, displayName);
}

describe("kickPeer", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("sets is_active=0 for the matching public_key", async () => {
    const { kickPeer } = await import("../../src/team/kick.js");
    seedPeer(db, "pk1", "Alice");
    kickPeer(db, "pk1");
    const row = db.prepare("SELECT is_active FROM team_peers WHERE public_key = 'pk1'").get() as { is_active: number };
    expect(row.is_active).toBe(0);
  });

  it("does not affect other peers", async () => {
    const { kickPeer } = await import("../../src/team/kick.js");
    seedPeer(db, "pk1", "Alice");
    seedPeer(db, "pk2", "Bob");
    kickPeer(db, "pk1");
    const row = db.prepare("SELECT is_active FROM team_peers WHERE public_key = 'pk2'").get() as { is_active: number };
    expect(row.is_active).toBe(1);
  });

  it("throws when public_key not found", async () => {
    const { kickPeer } = await import("../../src/team/kick.js");
    expect(() => kickPeer(db, "nonexistent")).toThrow(/not found/i);
  });
});

describe("getTeamManifest", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("returns only active peers", async () => {
    const { getTeamManifest } = await import("../../src/team/kick.js");
    seedPeer(db, "pk1", "Alice");
    seedPeer(db, "pk2", "Bob");
    db.prepare("UPDATE team_peers SET is_active = 0 WHERE public_key = 'pk2'").run();
    const manifest = getTeamManifest(db);
    expect(manifest.peers).toHaveLength(1);
    expect(manifest.peers[0].publicKey).toBe("pk1");
  });

  it("returns empty peers array when no active peers", async () => {
    const { getTeamManifest } = await import("../../src/team/kick.js");
    const manifest = getTeamManifest(db);
    expect(manifest.peers).toEqual([]);
  });

  it("manifest includes displayName for each peer", async () => {
    const { getTeamManifest } = await import("../../src/team/kick.js");
    seedPeer(db, "pk1", "Alice");
    const manifest = getTeamManifest(db);
    expect(manifest.peers[0].displayName).toBe("Alice");
  });
});
