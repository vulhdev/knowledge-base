import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startDeviceFlow", () => {
  it("POSTs to device/code and returns parsed response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: "dev123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        interval: 5,
        expires_in: 900,
      }),
    });

    const { startDeviceFlow } = await import("../../src/team/github.js");
    const result = await startDeviceFlow();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://github.com/login/device/code",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.deviceCode).toBe("dev123");
    expect(result.userCode).toBe("ABCD-1234");
    expect(result.verificationUri).toBe("https://github.com/login/device");
    expect(result.interval).toBe(5);
    expect(result.expiresIn).toBe(900);
  });

  it("throws when GitHub returns non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { startDeviceFlow } = await import("../../src/team/github.js");
    await expect(startDeviceFlow()).rejects.toThrow("GitHub device flow failed: 500");
  });
});

describe("pollForToken", () => {
  it("returns access_token when authorization_pending then success", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: "authorization_pending" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "gho_abc123" }),
      });

    const { pollForToken } = await import("../../src/team/github.js");
    const token = await pollForToken("dev123", 0, 30);
    expect(token).toBe("gho_abc123");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws on access_denied", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: "access_denied" }),
    });

    const { pollForToken } = await import("../../src/team/github.js");
    await expect(pollForToken("dev123", 0, 30)).rejects.toThrow("access_denied");
  });

  it("throws on expired_token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: "expired_token" }),
    });

    const { pollForToken } = await import("../../src/team/github.js");
    await expect(pollForToken("dev123", 0, 30)).rejects.toThrow("expired_token");
  });

  it("throws when expiresIn elapses with no token", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ error: "authorization_pending" }),
    });

    const { pollForToken } = await import("../../src/team/github.js");
    await expect(pollForToken("dev123", 0, -1)).rejects.toThrow("timed out");
  });
});

describe("getGitHubUsername", () => {
  it("returns login from /user endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ login: "vulhdev", id: 12345 }),
    });

    const { getGitHubUsername } = await import("../../src/team/github.js");
    const username = await getGitHubUsername("gho_abc123");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/user",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer gho_abc123" }),
      }),
    );
    expect(username).toBe("vulhdev");
  });

  it("throws when API returns non-ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const { getGitHubUsername } = await import("../../src/team/github.js");
    await expect(getGitHubUsername("bad_token")).rejects.toThrow("GitHub API error: 401");
  });
});
