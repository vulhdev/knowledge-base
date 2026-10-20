import Hyperswarm from "hyperswarm";
import { createHash } from "node:crypto";
import { loadSettings } from "../config.js";
import type Database from "better-sqlite3";

export type SwarmHandle = {
  swarm: InstanceType<typeof Hyperswarm>;
  topic: Buffer;
  destroy: () => Promise<void>;
};

export function deriveTopicBuffer(workspaceName: string, secret: string): Buffer {
  return createHash("sha256").update(`${workspaceName}:${secret}`).digest();
}

export function createFirewall(db: Database.Database): (remotePublicKey: Buffer) => boolean {
  return (remotePublicKey: Buffer): boolean => {
    const hexKey = remotePublicKey.toString("hex");
    const row = db
      .prepare("SELECT is_active FROM team_peers WHERE public_key = ?")
      .get(hexKey) as { is_active: number } | undefined;
    return !(row?.is_active === 1);
  };
}

export function createSwarm(db: Database.Database, workspaceName: string): SwarmHandle {
  const settings = loadSettings();
  const team = settings.workspaces?.[workspaceName]?.team;
  if (!team) throw new Error(`No team config for workspace "${workspaceName}"`);

  const keyPair = {
    publicKey: Buffer.from(team.noise_keypair.publicKey, "hex"),
    secretKey: Buffer.from(team.noise_keypair.secretKey, "hex"),
  };

  const swarm = new Hyperswarm({ keyPair, firewall: createFirewall(db) });
  const topic = deriveTopicBuffer(workspaceName, team.secret);
  swarm.join(topic);

  return {
    swarm,
    topic,
    destroy: () => swarm.destroy(),
  };
}
