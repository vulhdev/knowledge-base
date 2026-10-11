export type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
};

export type PollResult =
  | { pending: true }
  | { access_token: string; github_login: string };

export async function initiateDeviceFlow(clientId: string): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams({
    client_id: clientId,
    scope: "read:user",
  });

  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub device/code failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<DeviceCodeResponse>;
}

export async function pollDeviceFlow(
  clientId: string,
  clientSecret: string,
  deviceCode: string
): Promise<PollResult> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = (await res.json()) as Record<string, string>;

  if (data.error === "authorization_pending") {
    return { pending: true };
  }

  if (data.error === "slow_down") {
    throw new Error("slow_down: increase polling interval");
  }

  if (data.error === "expired_token") {
    throw new Error("expired_token: device code has expired, restart login");
  }

  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error}`);
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${data.access_token}`,
      Accept: "application/vnd.github+json",
    },
  });

  const user = (await userRes.json()) as { login: string };

  return { access_token: data.access_token, github_login: user.login };
}
