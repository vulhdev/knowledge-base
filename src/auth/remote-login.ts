export type DeviceFlowInitResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval?: number;
  expires_in?: number;
};

export type DeviceTokenResponse =
  | { pending: true }
  | { session_token: string; github_login: string };

export async function initiateRemoteDeviceFlow(
  serverUrl: string
): Promise<DeviceFlowInitResponse> {
  const res = await fetch(`${serverUrl}/auth/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? res.statusText);
  }
  return res.json() as Promise<DeviceFlowInitResponse>;
}

export async function pollRemoteDeviceToken(
  serverUrl: string,
  deviceCode: string
): Promise<DeviceTokenResponse> {
  const res = await fetch(`${serverUrl}/auth/device/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode }),
  });
  if (res.status === 410) {
    throw new Error("expired_token: device code has expired");
  }
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? res.statusText);
  }
  return res.json() as Promise<DeviceTokenResponse>;
}
