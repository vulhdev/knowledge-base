import { describe, it, expect } from "vitest";

describe("invite module", () => {
  it("parseInviteKey splits valid key into hostPublicKey and pendingToken", async () => {
    const { parseInviteKey } = await import("../../src/team/invite.js");
    const hostPk = "a".repeat(64);
    const token = "b".repeat(32);
    const result = parseInviteKey(`${hostPk}:${token}`);
    expect(result.hostPublicKey).toBe(hostPk);
    expect(result.pendingToken).toBe(token);
  });

  it("parseInviteKey throws on missing colon separator", async () => {
    const { parseInviteKey } = await import("../../src/team/invite.js");
    expect(() => parseInviteKey("a".repeat(96))).toThrow(/invalid invite key/i);
  });

  it("parseInviteKey throws when hostPublicKey is not 64 hex chars", async () => {
    const { parseInviteKey } = await import("../../src/team/invite.js");
    expect(() => parseInviteKey("tooshort:" + "b".repeat(32))).toThrow(/invalid invite key/i);
  });

  it("parseInviteKey throws when pendingToken is not 32 hex chars", async () => {
    const { parseInviteKey } = await import("../../src/team/invite.js");
    expect(() => parseInviteKey("a".repeat(64) + ":tooshort")).toThrow(/invalid invite key/i);
  });

  it("parseInviteKey throws on non-hex characters", async () => {
    const { parseInviteKey } = await import("../../src/team/invite.js");
    expect(() => parseInviteKey("z".repeat(64) + ":" + "b".repeat(32))).toThrow(/invalid invite key/i);
  });

  it("buildInviteKey produces <hostPublicKey>:<pendingToken>", async () => {
    const { buildInviteKey } = await import("../../src/team/invite.js");
    const result = buildInviteKey("a".repeat(64), "b".repeat(32));
    expect(result).toBe("a".repeat(64) + ":" + "b".repeat(32));
  });

  it("generatePendingToken returns a 32-char hex string", async () => {
    const { generatePendingToken } = await import("../../src/team/invite.js");
    const token = generatePendingToken();
    expect(token).toHaveLength(32);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });
});
