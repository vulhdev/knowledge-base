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

describe("listPeers", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("returns empty array when no peers", async () => {
    const { listPeers } = await import("../../src/team/kick.js");
    expect(listPeers(db)).toEqual([]);
  });

  it("returns all peers sorted by joined_at", async () => {
    const { listPeers } = await import("../../src/team/kick.js");
    db.prepare("INSERT INTO team_peers (public_key, display_name, joined_at) VALUES (?, ?, ?)").run("pk2", "Bob", "2026-10-05");
    db.prepare("INSERT INTO team_peers (public_key, display_name, joined_at) VALUES (?, ?, ?)").run("pk1", "Alice", "2026-10-01");
    const rows = listPeers(db);
    expect(rows).toHaveLength(2);
    expect(rows[0].public_key).toBe("pk1");
    expect(rows[1].public_key).toBe("pk2");
  });

  it("includes inactive peers", async () => {
    const { listPeers } = await import("../../src/team/kick.js");
    seedPeer(db, "pk1", "Alice");
    db.prepare("UPDATE team_peers SET is_active = 0 WHERE public_key = 'pk1'").run();
    const rows = listPeers(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_active).toBe(0);
  });
});

describe("findPeerByUsername", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("returns undefined when not found", async () => {
    const { findPeerByUsername } = await import("../../src/team/kick.js");
    expect(findPeerByUsername(db, "ghost")).toBeUndefined();
  });

  it("returns public_key and is_active when found", async () => {
    const { findPeerByUsername } = await import("../../src/team/kick.js");
    db.prepare("INSERT INTO team_peers (public_key, display_name, github_username) VALUES (?, ?, ?)").run("pk1", "Alice", "alice");
    const result = findPeerByUsername(db, "alice");
    expect(result).toEqual({ public_key: "pk1", is_active: 1 });
  });

  it("returns is_active=0 for kicked peer", async () => {
    const { findPeerByUsername } = await import("../../src/team/kick.js");
    db.prepare("INSERT INTO team_peers (public_key, display_name, github_username) VALUES (?, ?, ?)").run("pk1", "Alice", "alice");
    db.prepare("UPDATE team_peers SET is_active = 0 WHERE public_key = 'pk1'").run();
    const result = findPeerByUsername(db, "alice");
    expect(result?.is_active).toBe(0);
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
