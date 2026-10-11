import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initiateDeviceFlow, pollDeviceFlow } from "../../src/auth/device-flow.js";

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("initiateDeviceFlow", () => {
  it("POSTs to GitHub device/code endpoint with clientId", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: "dev123",
        user_code: "ABCD-EFGH",
        verification_uri: "https://github.com/login/device",
        interval: 5,
        expires_in: 900,
      }),
    });

    const result = await initiateDeviceFlow("client_id_abc");
    expect(result.device_code).toBe("dev123");
    expect(result.user_code).toBe("ABCD-EFGH");
    expect(result.verification_uri).toBe("https://github.com/login/device");

    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://github.com/login/device/code");
    const body = new URLSearchParams(opts.body as string);
    expect(body.get("client_id")).toBe("client_id_abc");
    expect(body.get("scope")).toContain("read:user");
  });

  it("throws on non-ok response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(initiateDeviceFlow("bad_client")).rejects.toThrow(/401/);
  });
});

describe("pollDeviceFlow", () => {
  it("returns access_token and github_login on success", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "gho_abc123", token_type: "bearer" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "alice", id: 1 }),
      });

    const result = await pollDeviceFlow("cid", "csecret", "dev123");
    expect(result.access_token).toBe("gho_abc123");
    expect(result.github_login).toBe("alice");
  });

  it("returns authorization_pending when not yet approved", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: "authorization_pending" }),
    });

    const result = await pollDeviceFlow("cid", "csecret", "dev123");
    expect(result.pending).toBe(true);
  });

  it("throws on slow_down error", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: "slow_down" }),
    });

    await expect(pollDeviceFlow("cid", "csecret", "dev123")).rejects.toThrow(/slow_down/);
  });

  it("throws on expired_token", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: "expired_token" }),
    });

    await expect(pollDeviceFlow("cid", "csecret", "dev123")).rejects.toThrow(/expired/);
  });
});
