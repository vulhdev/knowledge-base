import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../setup.js";
import type Database from "better-sqlite3";
import { insertTeam, listInvites } from "../../src/db/team.js";
import { createWorkspace } from "../../src/db/workspaces.js";
import { generateInvite } from "../../src/team/invite.js";

const HOST_PK = "a".repeat(64);

let db: Database.Database;
let wsId: number;

beforeEach(() => {
  db = createTestDb();
  const ws = createWorkspace(db, "my-ws");
  wsId = ws.id;
  insertTeam(db, wsId, {
    role: "host",
    secret: "s".repeat(64),
    noise_public_key: HOST_PK,
    noise_secret_key: "k".repeat(64),
    host_public_key: null,
    last_synced_at: null,
  });
});

describe("buildInviteCode", () => {
  it("returns hostPublicKey:workspaceName", async () => {
    const { buildInviteCode } = await import("../../src/team/invite.js");
    expect(buildInviteCode(HOST_PK, "my-ws")).toBe(`${HOST_PK}:my-ws`);
  });
});

describe("parseInviteCode", () => {
  it("parses valid invite code", async () => {
    const { parseInviteCode } = await import("../../src/team/invite.js");
    const result = parseInviteCode(`${HOST_PK}:my-workspace`);
    expect(result.hostPublicKey).toBe(HOST_PK);
    expect(result.workspaceName).toBe("my-workspace");
  });

  it("throws on missing colon", async () => {
    const { parseInviteCode } = await import("../../src/team/invite.js");
    expect(() => parseInviteCode("a".repeat(64))).toThrow(/invalid invite code/i);
  });

  it("throws when hostPublicKey is not 64 hex chars", async () => {
    const { parseInviteCode } = await import("../../src/team/invite.js");
    expect(() => parseInviteCode("tooshort:my-ws")).toThrow(/invalid invite code/i);
  });

  it("throws when workspaceName is empty", async () => {
    const { parseInviteCode } = await import("../../src/team/invite.js");
    expect(() => parseInviteCode(`${HOST_PK}:`)).toThrow(/workspaceName is empty/i);
  });

  it("[HIGH-SEC] throws when workspaceName contains disallowed characters (prompt injection guard)", async () => {
    const { parseInviteCode } = await import("../../src/team/invite.js");
    // workspaceName must match ^[a-zA-Z0-9_-]{1,64}$
    expect(() => parseInviteCode(`${HOST_PK}:ws with spaces`)).toThrow(/invalid.*workspace/i);
    expect(() => parseInviteCode(`${HOST_PK}:ws<script>alert(1)</script>`)).toThrow(/invalid.*workspace/i);
    expect(() => parseInviteCode(`${HOST_PK}:ws\nINJECTED_INSTRUCTION`)).toThrow(/invalid.*workspace/i);
  });

  it("[HIGH-SEC] accepts valid workspace names matching allowlist", async () => {
    const { parseInviteCode } = await import("../../src/team/invite.js");
    expect(parseInviteCode(`${HOST_PK}:my-workspace`).workspaceName).toBe("my-workspace");
    expect(parseInviteCode(`${HOST_PK}:knowledge_base`).workspaceName).toBe("knowledge_base");
    expect(parseInviteCode(`${HOST_PK}:MyProject123`).workspaceName).toBe("MyProject123");
  });

  it("[HIGH-SEC] throws when workspaceName exceeds 64 characters", async () => {
    const { parseInviteCode } = await import("../../src/team/invite.js");
    const longName = "a".repeat(65);
    expect(() => parseInviteCode(`${HOST_PK}:${longName}`)).toThrow(/invalid.*workspace/i);
  });
});

describe("normalizeGithubUsername", () => {
  it("strips @ prefix", async () => {
    const { normalizeGithubUsername } = await import("../../src/team/invite.js");
    expect(normalizeGithubUsername("@vulhdev")).toBe("vulhdev");
  });

  it("accepts username without @", async () => {
    const { normalizeGithubUsername } = await import("../../src/team/invite.js");
    expect(normalizeGithubUsername("vulhdev")).toBe("vulhdev");
  });

  it("throws on invalid username", async () => {
    const { normalizeGithubUsername } = await import("../../src/team/invite.js");
    expect(() => normalizeGithubUsername("@")).toThrow(/invalid github username/i);
    expect(() => normalizeGithubUsername("has space")).toThrow(/invalid github username/i);
  });
});

describe("generateInvite", () => {
  it("returns invite code in <hostPublicKey>:<workspaceName> format and inserts invite row", () => {
    const code = generateInvite(db, "my-ws", "vulhdev");

    expect(code).toBe(`${HOST_PK}:my-ws`);
    expect(listInvites(db, wsId).map((i) => i.github_username)).toContain("vulhdev");
  });

  it("inviting multiple users inserts separate rows", () => {
    generateInvite(db, "my-ws", "alice");
    generateInvite(db, "my-ws", "bob");

    const usernames = listInvites(db, wsId).map((i) => i.github_username);
    expect(usernames).toContain("alice");
    expect(usernames).toContain("bob");
  });

  it("throws when no team config exists", () => {
    const freshDb = createTestDb();
    createWorkspace(freshDb, "missing-ws");

    expect(() => generateInvite(freshDb, "missing-ws", "vulhdev")).toThrow(/no team config/i);
  });

  it("throws when role is peer", () => {
    const peerDb = createTestDb();
    const peerWs = createWorkspace(peerDb, "my-ws");
    insertTeam(peerDb, peerWs.id, {
      role: "peer",
      secret: "s".repeat(64),
      noise_public_key: HOST_PK,
      noise_secret_key: "k".repeat(64),
      host_public_key: "h".repeat(64),
      last_synced_at: null,
    });

    expect(() => generateInvite(peerDb, "my-ws", "vulhdev")).toThrow(/only the host/i);
  });
});
