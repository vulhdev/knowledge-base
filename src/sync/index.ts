import type Database from "better-sqlite3";
import Hyperswarm from "hyperswarm";
import { createSwarm } from "./peer.js";
import { deriveJoinTopic, handleJoinRequest } from "./join.js";
import { decodeChangeset, encodeChangeset, getChanges, applyChanges, MAX_CHANGESET_BYTES } from "./changeset.js";
import type { ChangesetRow } from "./changeset.js";
import type { ActivityLogger } from "./activity.js";
import { rebuildFts } from "./rebuild.js";
import { loadSettings, writeSettings } from "../config.js";
import { acquireSyncLock } from "./lock.js";

const MAX_HANDSHAKE_BYTES = 4 * 1024;   // generous for {"v":1,"dbVersion":9999999}
const MAX_JOIN_REQUEST_BYTES = 8 * 1024; // generous for a join_request JSON

export type SyncHandle = {
  destroy: () => Promise<void>;
};

type SyncCallbacks = {
  onChangesReceived?: (rows: ChangesetRow[]) => void;
  onChangesSent?: (count: number) => void;
};

type JoinCallbacks = {
  onJoinAttempt?: (githubUsername: string) => void;
  onJoinResult?: (githubUsername: string, accepted: boolean, reason?: string) => void;
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

export function handleSyncConnection(
  db: Database.Database,
  workspaceName: string,
  socket: NodeJS.ReadWriteStream,
  callbacks?: SyncCallbacks,
): void {
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
      if (buf.length > MAX_HANDSHAKE_BYTES) {
        (socket as NodeJS.ReadWriteStream & { destroy(): void }).destroy();
        return;
      }
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
        if (changes.length > 0) callbacks?.onChangesSent?.(changes.length);
      } catch {
        return;
      }
    } else {
      while (buf.length >= 4) {
        const size = buf.readUInt32BE(0);
        if (size === 0) { buf = buf.slice(4); continue; }
        if (size > MAX_CHANGESET_BYTES) { (socket as NodeJS.ReadWriteStream & { destroy(): void }).destroy(); return; }
        if (buf.length < 4 + size) break;
        try {
          const rows = decodeChangeset(buf.slice(4, 4 + size));
          applyChanges(db, rows);
          rebuildFts(db);
          recordSyncTimestamp(workspaceName);
          if (rows.length > 0) callbacks?.onChangesReceived?.(rows);
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
  callbacks?: JoinCallbacks,
): void {
  let buf = Buffer.alloc(0);
  let handled = false;

  const dataHandler = (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > MAX_JOIN_REQUEST_BYTES) {
      (socket as NodeJS.ReadWriteStream & { destroy(): void }).destroy();
      return;
    }
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
      if (req.type !== "join_request") {
        (socket as NodeJS.WritableStream).write(
          JSON.stringify({ type: "join_result", accepted: false, reason: "expected join_request" }) + "\n",
        );
        (socket as NodeJS.ReadWriteStream & { destroy(): void }).destroy();
        return;
      }
      if (req.peerPublicKey !== noisePublicKey.toString("hex")) {
        (socket as NodeJS.WritableStream).write(
          JSON.stringify({ type: "join_result", accepted: false, reason: "public key mismatch" }) + "\n",
        );
        (socket as NodeJS.ReadWriteStream & { destroy(): void }).destroy();
        return;
      }

      const claimedUsername = req.githubUsername ?? "(unknown)";
      callbacks?.onJoinAttempt?.(claimedUsername);

      handleJoinRequest(db, workspaceName, {
        githubToken: req.githubToken,
        peerPublicKey: req.peerPublicKey,
        githubUsername: req.githubUsername,
      }).then((result) => {
        callbacks?.onJoinResult?.(claimedUsername, result.accepted, result.accepted ? undefined : (result as { reason: string }).reason);
        if ((socket as unknown as MockableSocket).writable !== false) {
          (socket as NodeJS.WritableStream).write(JSON.stringify({ type: "join_result", ...result }) + "\n");
        }
      }).catch(() => {
        callbacks?.onJoinResult?.(claimedUsername, false, "internal error");
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

function lookupUsername(db: Database.Database, publicKey: string): string | null {
  try {
    const row = db
      .prepare("SELECT github_username FROM team_peers WHERE public_key = ?")
      .get(publicKey) as { github_username: string | null } | undefined;
    return row?.github_username ?? null;
  } catch {
    return null;
  }
}

export function startSync(
  db: Database.Database,
  workspaceName: string,
  logger?: ActivityLogger,
): SyncHandle | null {
  const release = acquireSyncLock(workspaceName);
  if (!release) return null;

  const settings = loadSettings();
  const team = settings.workspaces?.[workspaceName]?.team;
  if (!team) {
    release();
    throw new Error(`No team config for workspace "${workspaceName}"`);
  }

  const { swarm, destroy: destroySwarm } = createSwarm(db, workspaceName);
  swarm.on("connection", (socket: NodeJS.ReadWriteStream, info: { publicKey: Buffer }) => {
    const publicKey = info.publicKey.toString("hex");
    const username = lookupUsername(db, publicKey);
    logger?.onPeerConnect(workspaceName, username, publicKey);
    (socket as NodeJS.EventEmitter).once("close", () => {
      logger?.onPeerDisconnect(workspaceName, username, publicKey);
    });
    handleSyncConnection(db, workspaceName, socket, {
      onChangesReceived: (rows) => logger?.onChangesetReceived(workspaceName, username, rows, db),
      onChangesSent: (count) => logger?.onChangesetSent(workspaceName, username, count),
    });
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
      handleJoinConnection(db, workspaceName, socket, info.publicKey, {
        onJoinAttempt: (u) => logger?.onJoinAttempt(workspaceName, u),
        onJoinResult: (u, accepted, reason) => logger?.onJoinResult(workspaceName, u, accepted, reason),
      });
    });
    joinSwarm.on("error", () => { /* connection-level errors are expected (timeouts, resets) */ });
  }

  return {
    destroy: async () => {
      if (joinSwarm) await joinSwarm.destroy();
      await destroySwarm();
      release();
    },
  };
}
