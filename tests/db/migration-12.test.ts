import { describe, it, expect } from "vitest";
import { createTestDb } from "../setup.js";
import { applySchema } from "../../src/db/schema.js";

describe("migration 12: team_peers table", () => {
  it("creates team_peers table", () => {
    const db = createTestDb();
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'team_peers'")
      .get() as { name: string } | undefined;
    expect(table?.name).toBe("team_peers");
  });

  it("team_peers has expected columns", () => {
    const db = createTestDb();
    const cols = (
      db.prepare("SELECT name FROM pragma_table_info('team_peers')").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain("id");
    expect(cols).toContain("public_key");
    expect(cols).toContain("display_name");
    expect(cols).toContain("is_active");
    expect(cols).toContain("joined_at");
  });

  it("public_key has a UNIQUE constraint", () => {
    const db = createTestDb();
    db.prepare("INSERT INTO team_peers (public_key, display_name) VALUES (?, ?)").run("pubkey1", "Alice");
    expect(() =>
      db.prepare("INSERT INTO team_peers (public_key, display_name) VALUES (?, ?)").run("pubkey1", "Bob"),
    ).toThrow();
  });

  it("is_active defaults to 1", () => {
    const db = createTestDb();
    db.prepare("INSERT INTO team_peers (public_key, display_name) VALUES (?, ?)").run("pk", "Alice");
    const row = db.prepare("SELECT is_active FROM team_peers WHERE public_key = 'pk'").get() as {
      is_active: number;
    };
    expect(row.is_active).toBe(1);
  });

  it("joined_at defaults to current datetime", () => {
    const db = createTestDb();
    db.prepare("INSERT INTO team_peers (public_key, display_name) VALUES (?, ?)").run("pk2", "Bob");
    const row = db.prepare("SELECT joined_at FROM team_peers WHERE public_key = 'pk2'").get() as {
      joined_at: string;
    };
    expect(row.joined_at).toBeTruthy();
  });

  it("is idempotent — running applySchema twice is safe", () => {
    const db = createTestDb();
    expect(() => applySchema(db)).not.toThrow();
  });
});

describe("migration 12: created_by / updated_by on contents", () => {
  it("contents has created_by column", () => {
    const db = createTestDb();
    const cols = (
      db.prepare("SELECT name FROM pragma_table_info('contents')").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain("created_by");
  });

  it("contents has updated_by column", () => {
    const db = createTestDb();
    const cols = (
      db.prepare("SELECT name FROM pragma_table_info('contents')").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain("updated_by");
  });

  it("created_by defaults to NULL for existing rows", () => {
    const db = createTestDb();
    db.prepare("INSERT INTO contents (type, body) VALUES ('idea', 'hello')").run();
    const row = db.prepare("SELECT created_by, updated_by FROM contents WHERE body = 'hello'").get() as {
      created_by: string | null;
      updated_by: string | null;
    };
    expect(row.created_by).toBeNull();
    expect(row.updated_by).toBeNull();
  });

  it("created_by and updated_by accept identity strings", () => {
    const db = createTestDb();
    db.prepare(
      "INSERT INTO contents (type, body, created_by, updated_by) VALUES ('spec', 'body', ?, ?)",
    ).run("Alice <alice@example.com>", "Alice <alice@example.com>");
    const row = db.prepare("SELECT created_by FROM contents WHERE body = 'body'").get() as {
      created_by: string;
    };
    expect(row.created_by).toBe("Alice <alice@example.com>");
  });
});
