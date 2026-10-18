import { randomBytes, generateKeyPairSync } from "node:crypto";
import type { WorkspaceTeamConfig, NoiseKeypair } from "../config.js";

export function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

export function generateNoiseKeypair(): NoiseKeypair {
  const { publicKey, privateKey } = generateKeyPairSync("x25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  // Raw X25519 keys are the last 32 bytes of DER-encoded SPKI/PKCS8
  return {
    publicKey:  publicKey.subarray(-32).toString("hex"),
    secretKey:  privateKey.subarray(-32).toString("hex"),
  };
}

export function generateTeamConfig(): WorkspaceTeamConfig {
  return {
    role: "host",
    secret: generateSecret(),
    noise_keypair: generateNoiseKeypair(),
  };
}
