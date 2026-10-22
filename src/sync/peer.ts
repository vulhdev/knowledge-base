import Hyperswarm from "hyperswarm";
import HyperDHT from "hyperdht";
import { createHash } from "node:crypto";
import { getTeamByName } from "../db/team.js";
import type Database from "better-sqlite3";

export type SwarmHandle = {
  swarm: InstanceType<typeof Hyperswarm>;
  topic: Buffer;
  destroy: () => Promise<void>;
};

export function deriveTopicBuffer(workspaceName: string, secret: string): Buffer {
  return createHash("sha256").update(`${workspaceName}:${secret}`).digest();
}

function parseBootstrapEnv(): { host: string; port: number }[] | undefined {
  const env = process.env.KB_DHT_BOOTSTRAP;
  if (!env) return undefined;
  return env.split(",").map((addr) => {
    const [host, portStr] = addr.split(":");
    return { host: host ?? "127.0.0.1", port: Number(portStr) };
  });
}

export function createFirewall(db: Database.Database): (remotePublicKey: Buffer) => boolean {
  return (remotePublicKey: Buffer): boolean => {
    const hexKey = remotePublicKey.toString("hex");
    const row = db
      .prepare("SELECT is_active FROM team_peers WHERE public_key = ?")
      .get(hexKey) as { is_active: number } | undefined;
    // Only block kicked peers. Unknown peers may be joining and are handled by the connection handler.
    return row?.is_active === 0;
  };
}

export function createSwarm(db: Database.Database, workspaceName: string): SwarmHandle {
  const team = getTeamByName(db, workspaceName);
  if (!team) throw new Error(`No team config for workspace "${workspaceName}"`);

  const keyPair = {
    publicKey: Buffer.from(team.noise_public_key, "hex"),
    secretKey: Buffer.from(team.noise_secret_key, "hex"),
  };

  const bootstrap = parseBootstrapEnv();
  // KB_DHT_OPEN=1: Docker bridge IPs are bogon so dht-rpc's default firewalled=true makes
  // remoteAddress() return null → FIREWALL.UNKNOWN → holepunch fails inside Docker bridge.
  // With firewalled=false remoteAddress() returns the container IP → FIREWALL.OPEN → direct.
  const dhtNode = process.env.KB_DHT_OPEN === "1"
    ? new HyperDHT({ ...(bootstrap && { bootstrap }), firewalled: false })
    : undefined;
  const swarm = new Hyperswarm({ keyPair, firewall: createFirewall(db), ...(dhtNode ? { dht: dhtNode } : (bootstrap && { bootstrap })) });
  const topic = deriveTopicBuffer(workspaceName, team.secret);
  swarm.join(topic);

  return {
    swarm,
    topic,
    destroy: () => swarm.destroy(),
  };
}
