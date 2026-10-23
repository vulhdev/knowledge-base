import { describe, it, expect } from "vitest";

describe("generate module", () => {
  it("generateSecret returns a 64-char hex string", async () => {
    const { generateSecret } = await import("../../src/team/generate.js");
    const s = generateSecret();
    expect(s).toHaveLength(64);
    expect(s).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generateSecret returns a different value each time", async () => {
    const { generateSecret } = await import("../../src/team/generate.js");
    expect(generateSecret()).not.toBe(generateSecret());
  });

  it("generateNoiseKeypair returns publicKey as 64-char hex and secretKey as 128-char hex", async () => {
    const { generateNoiseKeypair } = await import("../../src/team/generate.js");
    const kp = generateNoiseKeypair();
    expect(kp.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(kp.secretKey).toMatch(/^[0-9a-f]{128}$/);
  });

  it("generateNoiseKeypair publicKey differs from secretKey", async () => {
    const { generateNoiseKeypair } = await import("../../src/team/generate.js");
    const kp = generateNoiseKeypair();
    expect(kp.publicKey).not.toBe(kp.secretKey);
  });

});
