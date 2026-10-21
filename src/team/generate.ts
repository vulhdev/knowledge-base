import { randomBytes, generateKeyPairSync } from "node:crypto";
import type { WorkspaceTeamConfig, NoiseKeypair } from "../config.js";

export function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

export function generateNoiseKeypair(): NoiseKeypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  // Hyperswarm expects Ed25519: publicKey=32 bytes, secretKey=64 bytes (seed ++ publicKey)
  const pubRaw = publicKey.subarray(-32);
  const seedRaw = privateKey.subarray(-32);
  return {
    publicKey: pubRaw.toString("hex"),
    secretKey: Buffer.concat([seedRaw, pubRaw]).toString("hex"),
  };
}

export function generateTeamConfig(): WorkspaceTeamConfig {
  return {
    role: "host",
    secret: generateSecret(),
    noise_keypair: generateNoiseKeypair(),
  };
}
