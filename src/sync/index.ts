import type Database from "better-sqlite3";
import { createSwarm } from "./peer.js";
import { deriveJoinTopic, handleJoinRequest } from "./join.js";
import { decodeChangeset, encodeChangeset, getChanges, applyChanges, MAX_CHANGESET_BYTES } from "./changeset.js";
import type { ChangesetRow } from "./changeset.js";
import type { ActivityLogger } from "./activity.js";
import { rebuildFts } from "./rebuild.js";
import { getTeamByName, updateLastSynced } from "../db/team.js";
import { acquireSyncLock } from "./lock.js";
import { registerPusher } from "./push.js";

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
  onSyncStarted?: (handle: { pushDelta: () => void }) => void;
};

export function recordSyncTimestamp(db: Database.Database, workspaceName: string): void {
  const team = getTeamByName(db, workspaceName);
  if (team) updateLastSynced(db, team.workspace_id, new Date().toISOString());
}

type HandshakeMsg = { v: number; dbVersion: number };
type BootstrapFrame = { type: "bootstrap"; features: { id: string; name: string }[] };

const PROTOCOL_VERSION = 1;

function getBootstrapFeatures(db: Database.Database, workspaceName: string): { id: string; name: string }[] {
  try {
    return db
      .prepare("SELECT f.id, f.name FROM features f JOIN workspaces w ON w.id = f.workspace_id WHERE w.name = ?")
      .all(workspaceName) as { id: string; name: string }[];
  } catch {
    return [];
  }
}

const BOOTSTRAP_MAX_FEATURES = 5_000;
const BOOTSTRAP_MAX_NAME_LEN = 500;
const BOOTSTRAP_MAX_ID_LEN = 128;

function applyBootstrapFeatures(db: Database.Database, workspaceName: string, features: { id: string; name: string }[]): void {
  // Validate input to prevent a malicious host from flooding rows or injecting long strings.
  if (features.length > BOOTSTRAP_MAX_FEATURES) return;
  for (const f of features) {
    if (typeof f.id !== "string" || f.id.length === 0 || f.id.length > BOOTSTRAP_MAX_ID_LEN) return;
    if (typeof f.name !== "string" || f.name.length === 0 || f.name.length > BOOTSTRAP_MAX_NAME_LEN) return;
  }

  const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(workspaceName) as { id: number } | undefined;
  if (!ws) return;
  const insert = db.prepare("INSERT OR IGNORE INTO features (id, workspace_id, name) VALUES (?, ?, ?)");
  db.transaction(() => {
    for (const f of features) {
      insert.run(f.id, ws.id, f.name);
    }
  })();
}

function encodeFrame(obj: unknown): Buffer {
  const encoded = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(encoded.length, 0);
  return Buffer.concat([header, encoded]);
}

export function handleSyncConnection(
  db: Database.Database,
  workspaceName: string,
  socket: NodeJS.ReadWriteStream,
  callbacks?: SyncCallbacks,
): { pushDelta: () => void } {
  let localDbVersion: number;
  try {
    const row = db
      .prepare("SELECT MAX(db_version) AS v FROM crsql_changes")
      .get() as { v: number | null } | undefined;
    localDbVersion = row?.v ?? 0;
  } catch {
    return { pushDelta: () => undefined };
  }

  const handshake: HandshakeMsg = { v: PROTOCOL_VERSION, dbVersion: localDbVersion };
  let buf = Buffer.alloc(0);
  let peerVersion: number | null = null;
  // When this peer is fresh (localDbVersion=0), the first frame from the remote may be a bootstrap.
  let awaitingBootstrap = localDbVersion === 0;
  let lastSentDbVersion = localDbVersion;

  (socket as NodeJS.WritableStream).write(JSON.stringify(handshake) + "\n");

  (socket as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);

    if (peerVersion === null) {
      const newline = buf.indexOf(0x0a);
      if (newline === -1) {
        // Guard against a peer sending a huge blob with no newline (no valid handshake).
        // Check only pre-newline bytes so a large changeset arriving in the same segment
        // does not trigger this limit on loopback/high-MTU interfaces.
        if (buf.length > MAX_HANDSHAKE_BYTES) {
          (socket as NodeJS.ReadWriteStream & { destroy(): void }).destroy();
        }
        return;
      }
      const line = buf.slice(0, newline).toString("utf8");
      buf = buf.slice(newline + 1);
      try {
        const msg = JSON.parse(line) as HandshakeMsg;
        peerVersion = msg.dbVersion;
        // When peer is fresh, send bootstrap features before the changeset so the peer can
        // build the features table before applying content_features CRDT rows.
        if (peerVersion === 0) {
          const features = getBootstrapFeatures(db, workspaceName);
          (socket as NodeJS.WritableStream).write(encodeFrame({ type: "bootstrap", features } satisfies BootstrapFrame));
        }
        const changes = getChanges(db, peerVersion);
        const encoded = encodeChangeset(changes);
        const header = Buffer.allocUnsafe(4);
        header.writeUInt32BE(encoded.length, 0);
        (socket as NodeJS.WritableStream).write(Buffer.concat([header, encoded]));
        if (changes.length > 0) {
          callbacks?.onChangesSent?.(changes.length);
          if (changes.length > 0) {
            lastSentDbVersion = Math.max(lastSentDbVersion, ...changes.map(r => r.db_version));
          }
        }
      } catch {
        return;
      }
      // Fall through: if the remote sent bootstrap+changeset frames in the same segment
      // as the handshake (common on loopback), process them now instead of waiting for
      // the next data event that may never arrive.
    }

    while (buf.length >= 4) {
      const size = buf.readUInt32BE(0);
      if (size === 0) { buf = buf.slice(4); continue; }
      if (size > MAX_CHANGESET_BYTES) { (socket as NodeJS.ReadWriteStream & { destroy(): void }).destroy(); return; }
      if (buf.length < 4 + size) break;
      if (awaitingBootstrap) {
        awaitingBootstrap = false;
        try {
          const frame = JSON.parse(buf.slice(4, 4 + size).toString("utf8")) as Record<string, unknown>;
          if (frame.type === "bootstrap" && Array.isArray(frame.features)) {
            applyBootstrapFeatures(db, workspaceName, frame.features as { id: string; name: string }[]);
            buf = buf.slice(4 + size);
            continue;
          }
        } catch {
          // not a bootstrap frame — fall through to changeset handling
        }
      }
      try {
        const rows = decodeChangeset(buf.slice(4, 4 + size));
        applyChanges(db, rows);
        rebuildFts(db);
        recordSyncTimestamp(db, workspaceName);
        if (rows.length > 0) callbacks?.onChangesReceived?.(rows);
      } catch {
        // ignore bad changeset
      }
      buf = buf.slice(4 + size);
    }
  });

  return {
    pushDelta() {
      if ((socket as { writable?: boolean }).writable === false) return;
      const changes = getChanges(db, lastSentDbVersion);
      if (changes.length === 0) return;
      const encoded = encodeChangeset(changes);
      const header = Buffer.allocUnsafe(4);
      header.writeUInt32BE(encoded.length, 0);
      (socket as NodeJS.WritableStream).write(Buffer.concat([header, encoded]));
      lastSentDbVersion = Math.max(lastSentDbVersion, ...changes.map(r => r.db_version));
    },
  };
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
        appVersion?: string;
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
        appVersion: req.appVersion,
      }).then((result) => {
        callbacks?.onJoinResult?.(claimedUsername, result.accepted, result.accepted ? undefined : (result as { reason: string }).reason);
        if ((socket as unknown as MockableSocket).writable !== false) {
          (socket as NodeJS.WritableStream).write(JSON.stringify({ type: "join_result", ...result }) + "\n");
          // Reuse the open join socket for initial sync — peer calls performInitialSyncOnSocket
          // on the same socket, eliminating the DHT round-trip that caused timeouts.
          if (result.accepted) {
            const syncHandle = handleSyncConnection(db, workspaceName, socket);
            callbacks?.onSyncStarted?.(syncHandle);
          }
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

export function startSync(
  db: Database.Database,
  workspaceName: string,
  logger?: ActivityLogger,
): SyncHandle | null {
  const release = acquireSyncLock(workspaceName);
  if (!release) return null;

  const team = getTeamByName(db, workspaceName);
  if (!team) {
    release();
    throw new Error(`No team config for workspace "${workspaceName}"`);
  }

  const { swarm, destroy: destroySwarm } = createSwarm(db, workspaceName);
  swarm.on("error", () => { /* swarm-level errors (e.g. DHT timeouts) are expected */ });

  // Join the join topic on the SAME swarm to avoid DHT routing conflicts that arise when two
  // Hyperswarm instances share an identical noise keypair (same DHT node identity).
  const joinTopic = team.role === "host"
    ? deriveJoinTopic(workspaceName, team.noise_public_key)
    : null;
  if (joinTopic) {
    swarm.join(joinTopic);
  }

  swarm.on("connection", (socket: NodeJS.ReadWriteStream, info: { publicKey: Buffer; topics: Buffer[] }) => {
    (socket as NodeJS.EventEmitter).on("error", () => { /* ECONNRESET and other connection errors are expected */ });
    const publicKey = info.publicKey.toString("hex");

    const peerRow = db
      .prepare("SELECT is_active, github_username FROM team_peers WHERE public_key = ?")
      .get(publicKey) as { is_active: number; github_username: string | null } | undefined;

    if (peerRow?.is_active === 0) {
      (socket as NodeJS.ReadWriteStream & { destroy(): void }).destroy();
      return;
    }

    const isActivePeer = peerRow?.is_active === 1;
    // info.topics is only populated when the local swarm initiates the connection (DHT client
    // side). When the remote peer initiates (DHT server side), info.topics is always [].
    // Rely on isActivePeer alone to route: if the peer is not a known active member and we are
    // the host, treat it as a join attempt. handleJoinConnection validates the request fully.
    const isJoinConn = !isActivePeer && joinTopic !== null;

    if (isJoinConn) {
      logger?.onJoinConnect(workspaceName, publicKey);
      handleJoinConnection(db, workspaceName, socket, info.publicKey, {
        onJoinAttempt: (u) => logger?.onJoinAttempt(workspaceName, u),
        onJoinResult: (u, accepted, reason) => logger?.onJoinResult(workspaceName, u, accepted, reason),
        onSyncStarted: ({ pushDelta }) => {
          const unregister = registerPusher(workspaceName, pushDelta);
          (socket as NodeJS.EventEmitter).once("close", unregister);
        },
      });
      return;
    }

    if (!isActivePeer) {
      (socket as NodeJS.ReadWriteStream & { destroy(): void }).destroy();
      return;
    }

    const username = peerRow?.github_username ?? null;
    logger?.onPeerConnect(workspaceName, username, publicKey);
    (socket as NodeJS.EventEmitter).once("close", () => {
      logger?.onPeerDisconnect(workspaceName, username, publicKey);
    });
    const { pushDelta } = handleSyncConnection(db, workspaceName, socket, {
      onChangesReceived: (rows) => logger?.onChangesetReceived(workspaceName, username, rows, db),
      onChangesSent: (count) => logger?.onChangesetSent(workspaceName, username, count),
    });
    const unregister = registerPusher(workspaceName, pushDelta);
    (socket as NodeJS.EventEmitter).once("close", unregister);
  });

  return {
    destroy: async () => {
      await destroySwarm();
      release();
    },
  };
}
