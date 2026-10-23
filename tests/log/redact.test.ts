import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { redactFields } from "../../src/log/redact.js";

describe("redactFields", () => {
  it("redacts body field with char count", () => {
    const result = redactFields({ body: "secret content" });
    expect(result.body).toBe("[body redacted, 14 chars]");
  });

  it("body length counts original string length", () => {
    const result = redactFields({ body: "hi" });
    expect(result.body).toBe("[body redacted, 2 chars]");
  });

  it("redacts secret field", () => {
    const result = redactFields({ secret: "mysecret123" });
    expect(result.secret).toBe("[redacted]");
  });

  it("redacts embedding field", () => {
    const result = redactFields({ embedding: new Float32Array(10) });
    expect(result.embedding).toBe("[redacted]");
  });

  it("redacts noise_public_key with [key redacted]", () => {
    const result = redactFields({ noise_public_key: "abc123" });
    expect(result.noise_public_key).toBe("[key redacted]");
  });

  it("redacts noise_secret_key with [key redacted]", () => {
    const result = redactFields({ noise_secret_key: "abc123" });
    expect(result.noise_secret_key).toBe("[key redacted]");
  });

  it("redacts any field containing 'token'", () => {
    const result = redactFields({ github_token: "tok123", access_token: "abc", token: "xyz" });
    expect(result.github_token).toBe("[token redacted]");
    expect(result.access_token).toBe("[token redacted]");
    expect(result.token).toBe("[token redacted]");
  });

  it("truncates host_public_key 64-hex to first 12 chars + ellipsis", () => {
    const hex64 = "a".repeat(64);
    const result = redactFields({ host_public_key: hex64 });
    expect(result.host_public_key).toBe("a".repeat(12) + "…");
  });

  it("truncates publicKey 64-hex to first 12 chars + ellipsis", () => {
    const hex64 = "deadbeef".repeat(8); // 64 chars
    const result = redactFields({ publicKey: hex64 });
    expect(result.publicKey).toBe("deadbeefde" + "ad" + "…");
  });

  it("truncates pub_key 64-hex to first 12 chars + ellipsis", () => {
    const hex64 = "1".repeat(64);
    const result = redactFields({ pub_key: hex64 });
    expect(result.pub_key).toBe("1".repeat(12) + "…");
  });

  it("replaces home directory prefix with ~", () => {
    const home = homedir();
    const result = redactFields({ path: `${home}/some/dir/file.db` });
    expect(result.path).toBe("~/some/dir/file.db");
  });

  it("truncates query field to 60 chars", () => {
    const long = "x".repeat(80);
    const result = redactFields({ query: long });
    expect(result.query).toBe("x".repeat(60) + "…");
  });

  it("does not truncate query <= 60 chars", () => {
    const short = "x".repeat(60);
    const result = redactFields({ query: short });
    expect(result.query).toBe(short);
  });

  it("redacts invite codes (string > 64 chars) with …[redacted]", () => {
    const invite = "b".repeat(100);
    const result = redactFields({ invite_code: invite });
    expect(result.invite_code).toBe("b".repeat(12) + "…[redacted]");
  });

  it("passes through short normal string values unchanged", () => {
    const result = redactFields({ event: "start", workspace: "kb" });
    expect(result.event).toBe("start");
    expect(result.workspace).toBe("kb");
  });

  it("converts numeric values to strings", () => {
    const result = redactFields({ count: 42, ms: 123 });
    expect(result.count).toBe("42");
    expect(result.ms).toBe("123");
  });

  it("converts boolean values to strings", () => {
    const result = redactFields({ found: true, ok: false });
    expect(result.found).toBe("true");
    expect(result.ok).toBe("false");
  });
});
