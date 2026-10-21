import Hyperswarm from "hyperswarm";
import type Database from "better-sqlite3";
import { getTeamByName } from "../db/team.js";
import { deriveTopicBuffer } from "./peer.js";
import { handleSyncConnection } from "./index.js";

export type InitialSyncResult =
  | { ok: true; rowsReceived: number }
  | { ok: false; reason: "timeout" | "crsql_unavailable" };

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
      swarm.destroy().catch(() => undefined).then(() => resolve({ ok: false, reason: "timeout" }));
    }, timeoutMs);

    (swarm as NodeJS.EventEmitter).on("connection", (socket: NodeJS.ReadWriteStream) => {
      clearTimeout(timer);
      let rowsReceived = 0;
      let settled = false;
      const settle = (result: InitialSyncResult) => {
        if (settled) return;
        settled = true;
        swarm.destroy().catch(() => undefined).then(() => resolve(result));
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
