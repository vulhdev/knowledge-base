import type Database from "better-sqlite3";
import Hyperswarm from "hyperswarm";
import { createSwarm } from "./peer.js";
import { deriveJoinTopic, handleJoinRequest } from "./join.js";
import { decodeChangeset, encodeChangeset, getChanges, applyChanges, MAX_CHANGESET_BYTES } from "./changeset.js";
import { rebuildFts } from "./rebuild.js";
import { loadSettings, writeSettings } from "../config.js";

export type SyncHandle = {
  destroy: () => Promise<void>;
};

export function recordSyncTimestamp(workspaceName: string): void {
  const s = loadSettings();
  if (s.workspaces?.[workspaceName]?.team) {
    s.workspaces[workspaceName].team!.last_synced_at = new Date().toISOString();
    writeSettings(s);
  }
}

type HandshakeMsg = { v: number; dbVersion: number };

const PROTOCOL_VERSION = 1;

export function handleSyncConnection(db: Database.Database, workspaceName: string, socket: NodeJS.ReadWriteStream): void {
  let localDbVersion = 0;
  try {
    const row = db
      .prepare("SELECT MAX(db_version) AS v FROM crsql_changes")
      .get() as { v: number | null } | undefined;
    localDbVersion = row?.v ?? 0;
  } catch {
    return; // crsql_changes not available
  }

  const handshake: HandshakeMsg = { v: PROTOCOL_VERSION, dbVersion: localDbVersion };
  let buf = Buffer.alloc(0);
  let peerVersion: number | null = null;

  (socket as NodeJS.WritableStream).write(JSON.stringify(handshake) + "\n");

  (socket as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);

    if (peerVersion === null) {
      const newline = buf.indexOf(0x0a);
      if (newline === -1) return;
      const line = buf.slice(0, newline).toString("utf8");
      buf = buf.slice(newline + 1);
      try {
        const msg = JSON.parse(line) as HandshakeMsg;
        peerVersion = msg.dbVersion;
        const changes = getChanges(db, peerVersion);
        const encoded = encodeChangeset(changes);
        const header = Buffer.allocUnsafe(4);
        header.writeUInt32BE(encoded.length, 0);
        (socket as NodeJS.WritableStream).write(Buffer.concat([header, encoded]));
      } catch {
        return;
      }
    } else if (buf.length >= 4) {
      const size = buf.readUInt32BE(0);
      if (size === 0) { buf = buf.slice(4); return; }
      if (size > MAX_CHANGESET_BYTES) { (socket as NodeJS.ReadWriteStream & { destroy(): void }).destroy(); return; }
      if (buf.length >= 4 + size) {
        try {
          const rows = decodeChangeset(buf.slice(4, 4 + size));
          applyChanges(db, rows);
          rebuildFts(db);
          recordSyncTimestamp(workspaceName);
        } catch {
          // ignore bad changeset
        }
        buf = buf.slice(4 + size);
      }
    }
  });
}

export function handleJoinConnection(
  db: Database.Database,
  workspaceName: string,
  socket: NodeJS.ReadWriteStream,
  noisePublicKey: Buffer,
): void {
  let buf = Buffer.alloc(0);
  let handled = false;

  const dataHandler = (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    const newline = buf.indexOf(0x0a);
    if (newline === -1) return;
    if (handled) return;
    handled = true;
    (socket as NodeJS.ReadableStream).removeListener("data", dataHandler);

    const line = buf.slice(0, newline).toString("utf8");
    try {
      const req = JSON.parse(line) as {
        type: string;
        githubToken: string;
        peerPublicKey: string;
        githubUsername?: string;
      };
      if (req.type !== "join_request") return;
      if (req.peerPublicKey !== noisePublicKey.toString("hex")) {
        (socket as NodeJS.WritableStream).write(
          JSON.stringify({ type: "join_result", accepted: false, reason: "public key mismatch" }) + "\n",
        );
        return;
      }
      handleJoinRequest(db, workspaceName, {
        githubToken: req.githubToken,
        peerPublicKey: req.peerPublicKey,
        githubUsername: req.githubUsername,
      }).then((result) => {
        if ((socket as unknown as MockableSocket).writable !== false) {
          (socket as NodeJS.WritableStream).write(JSON.stringify({ type: "join_result", ...result }) + "\n");
        }
      }).catch(() => {
        if ((socket as unknown as MockableSocket).writable !== false) {
          (socket as NodeJS.WritableStream).write(
            JSON.stringify({ type: "join_result", accepted: false, reason: "internal error" }) + "\n",
          );
        }
      });
    } catch {
      // ignore malformed messages
    }
  };

  (socket as NodeJS.ReadableStream).on("data", dataHandler);
}

type MockableSocket = { writable?: boolean };

export function startSync(db: Database.Database, workspaceName: string): SyncHandle {
  const settings = loadSettings();
  const team = settings.workspaces?.[workspaceName]?.team;
  if (!team) throw new Error(`No team config for workspace "${workspaceName}"`);

  const { swarm, destroy: destroySwarm } = createSwarm(db, workspaceName);
  swarm.on("connection", (socket: NodeJS.ReadWriteStream) => {
    handleSyncConnection(db, workspaceName, socket);
  });

  let joinSwarm: InstanceType<typeof Hyperswarm> | null = null;
  if (team.role === "host") {
    const keyPair = {
      publicKey: Buffer.from(team.noise_keypair.publicKey, "hex"),
      secretKey: Buffer.from(team.noise_keypair.secretKey, "hex"),
    };
    joinSwarm = new Hyperswarm({ keyPair });
    joinSwarm.join(deriveJoinTopic(workspaceName, team.noise_keypair.publicKey));
    joinSwarm.on("connection", (socket: NodeJS.ReadWriteStream, info: { publicKey: Buffer }) => {
      handleJoinConnection(db, workspaceName, socket, info.publicKey);
    });
  }

  return {
    destroy: async () => {
      if (joinSwarm) await joinSwarm.destroy();
      await destroySwarm();
    },
  };
}
