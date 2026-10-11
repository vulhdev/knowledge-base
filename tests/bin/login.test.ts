import { describe, it, expect, vi, afterEach } from "vitest";
import { initiateRemoteDeviceFlow, pollRemoteDeviceToken } from "../../src/auth/remote-login.js";

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  return vi.fn(async () => {
    const resp = responses[call++] ?? responses[responses.length - 1];
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      statusText: "Mock",
      json: async () => resp.body,
    };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("initiateRemoteDeviceFlow", () => {
  it("returns device flow data on success", async () => {
    const payload = {
      device_code: "devcode",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      interval: 5,
      expires_in: 900,
    };
    vi.stubGlobal("fetch", mockFetch([{ status: 200, body: payload }]));

    const result = await initiateRemoteDeviceFlow("http://server:58000");
    expect(result.user_code).toBe("ABCD-1234");
    expect(result.device_code).toBe("devcode");
  });

  it("throws when server returns non-ok", async () => {
    vi.stubGlobal("fetch", mockFetch([{ status: 503, body: { error: "not configured" } }]));
    await expect(initiateRemoteDeviceFlow("http://server:58000")).rejects.toThrow("not configured");
  });
});

describe("pollRemoteDeviceToken", () => {
  it("returns { pending: true } when authorization pending", async () => {
    vi.stubGlobal("fetch", mockFetch([{ status: 200, body: { pending: true } }]));
    const result = await pollRemoteDeviceToken("http://server:58000", "devcode");
    expect(result).toEqual({ pending: true });
  });

  it("returns session_token and github_login on success", async () => {
    vi.stubGlobal("fetch", mockFetch([{ status: 200, body: { session_token: "tok123", github_login: "alice" } }]));
    const result = await pollRemoteDeviceToken("http://server:58000", "devcode");
    expect(result).toEqual({ session_token: "tok123", github_login: "alice" });
  });

  it("throws expired_token error on 410", async () => {
    vi.stubGlobal("fetch", mockFetch([{ status: 410, body: { error: "expired" } }]));
    await expect(pollRemoteDeviceToken("http://server:58000", "old")).rejects.toThrow("expired_token");
  });

  it("throws on server error", async () => {
    vi.stubGlobal("fetch", mockFetch([{ status: 502, body: { error: "gateway error" } }]));
    await expect(pollRemoteDeviceToken("http://server:58000", "devcode")).rejects.toThrow("gateway error");
  });
});
