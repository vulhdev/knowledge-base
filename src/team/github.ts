export const GITHUB_CLIENT_ID = "Ov23lii2FHmUVuFI9TSo";

export type DeviceFlowStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
};

export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: "read:user" }),
  });
  if (!res.ok) throw new Error(`GitHub device flow failed: ${res.status}`);
  const data = await res.json() as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval: number;
    expires_in: number;
  };
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval,
    expiresIn: data.expires_in,
  };
}

export async function pollForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
): Promise<string> {
  const deadline = Date.now() + expiresIn * 1000;

  const poll = async (): Promise<string> => {
    if (Date.now() >= deadline) throw new Error("GitHub auth timed out");

    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const data = await res.json() as { access_token?: string; error?: string };

    if (data.access_token) return data.access_token;
    if (data.error === "authorization_pending") {
      await wait(interval * 1000);
      return poll();
    }
    if (data.error === "slow_down") {
      await wait((interval + 5) * 1000);
      return poll();
    }
    throw new Error(`GitHub auth failed: ${data.error}`);
  };

  return poll();
}

export async function getGitHubUsername(token: string): Promise<string> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json() as { login: string };
  return data.login;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
