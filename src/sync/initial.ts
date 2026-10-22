import Hyperswarm from "hyperswarm";
import type Database from "better-sqlite3";
import { getTeamByName } from "../db/team.js";
import { deriveTopicBuffer } from "./peer.js";
import { handleSyncConnection } from "./index.js";

export type InitialSyncResult =
  | { ok: true; rowsReceived: number }
  | { ok: false; reason: "timeout" | "crsql_unavailable" };

// Run the sync protocol on an already-open socket (the join socket) instead of
// spinning up a new Hyperswarm and waiting for a DHT-routed connection.
// This avoids the 60-second timeout that occurs when DHT lookup is slow.
// remainder: bytes already buffered from the socket before handing it over (e.g. the
// sync handshake that arrived in the same TCP segment as the join_result).
export async function performInitialSyncOnSocket(
  db: Database.Database,
  workspaceName: string,
  socket: NodeJS.ReadWriteStream,
  remainder?: Buffer,
): Promise<InitialSyncResult> {
  try {
    db.prepare("SELECT crsql_site_id()").get();
  } catch {
    return { ok: false, reason: "crsql_unavailable" };
  }

  const team = getTeamByName(db, workspaceName);
  if (!team) return { ok: false, reason: "crsql_unavailable" };

  return new Promise((resolve) => {
    let rowsReceived = 0;
    let settled = false;
    const settle = (result: InitialSyncResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    handleSyncConnection(db, workspaceName, socket, {
      onChangesReceived: (rows) => { rowsReceived += rows.length; },
    });
    // Re-emit bytes already read from the socket (sync handshake that arrived together
    // with the join_result in the same segment) so the data handler processes them.
    if (remainder && remainder.length > 0) {
      process.nextTick(() => (socket as NodeJS.EventEmitter).emit("data", remainder));
    }
    (socket as NodeJS.EventEmitter).on("error", () => {
      settle({ ok: false, reason: "timeout" });
    });
    (socket as NodeJS.EventEmitter).once("close", () => {
      settle({ ok: true, rowsReceived });
    });
  });
}

export async function performInitialSync(
  db: Database.Database,
  workspaceName: string,
  timeoutMs = 60_000,
): Promise<InitialSyncResult> {
  try {
    db.prepare("SELECT crsql_site_id()").get();
  } catch {
    return { ok: false, reason: "crsql_unavailable" };
  }

  const team = getTeamByName(db, workspaceName);
  if (!team) return { ok: false, reason: "crsql_unavailable" };

  const keyPair = {
    publicKey: Buffer.from(team.noise_public_key, "hex"),
    secretKey: Buffer.from(team.noise_secret_key, "hex"),
  };
  const topic = deriveTopicBuffer(workspaceName, team.secret);
  const swarm = new Hyperswarm({ keyPair });
  swarm.join(topic);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      void swarm.destroy().catch(() => undefined).then(() => resolve({ ok: false, reason: "timeout" }));
    }, timeoutMs);

    (swarm as NodeJS.EventEmitter).on("connection", (socket: NodeJS.ReadWriteStream) => {
      clearTimeout(timer);
      let rowsReceived = 0;
      let settled = false;
      const settle = (result: InitialSyncResult) => {
        if (settled) return;
        settled = true;
        void swarm.destroy().catch(() => undefined).then(() => resolve(result));
      };
      handleSyncConnection(db, workspaceName, socket, {
        onChangesReceived: (rows) => { rowsReceived += rows.length; },
      });
      // Attach error handler before "close" so an ECONNRESET does not leak the promise.
      (socket as NodeJS.EventEmitter).on("error", () => {
        settle({ ok: false, reason: "timeout" });
      });
      (socket as NodeJS.EventEmitter).once("close", () => {
        settle({ ok: true, rowsReceived });
      });
    });
  });
}
