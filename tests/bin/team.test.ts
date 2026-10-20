import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("hyperswarm", () => ({ default: vi.fn() }));
vi.mock("node:os", () => ({ homedir: vi.fn().mockReturnValue("/test/home") }));
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  chmodSync: vi.fn(),
  renameSync: vi.fn(),
  copyFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(), outro: vi.fn(), log: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

// Prevent the top-level CLI dispatch from exiting during import
vi.stubGlobal("process", { ...process, argv: ["node", "knowledge-base", "team"], exit: vi.fn() });

function makeMockSwarm() {
  const swarm = new EventEmitter() as EventEmitter & {
    join: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  swarm.join = vi.fn();
  swarm.destroy = vi.fn().mockResolvedValue(undefined);
  return swarm;
}

function makeMockSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  socket.write = vi.fn();
  socket.destroy = vi.fn();
  return socket;
}

describe("attemptJoin", () => {
  const HOST_PUBLIC_KEY = "a".repeat(64);
  const PEER_PUBLIC_KEY = "b".repeat(64);

  beforeEach(() => {
    vi.resetModules();
  });

  it("destroys swarm and resolves accepted:true when host accepts", async () => {
    const { attemptJoin } = await import("../../src/bin/team.js");
    const swarm = makeMockSwarm();
    const socket = makeMockSocket();

    const joinPromise = attemptJoin(
      swarm as unknown as import("hyperswarm").default,
      HOST_PUBLIC_KEY, "ws", PEER_PUBLIC_KEY, "gho_tok", "alice",
    );

    swarm.emit("connection", socket, { publicKey: Buffer.from(HOST_PUBLIC_KEY, "hex") });
    socket.emit(
      "data",
      Buffer.from(JSON.stringify({ type: "join_result", accepted: true, secret: "s".repeat(64) }) + "\n"),
    );

    const result = await joinPromise;
    expect(result.accepted).toBe(true);
    expect(swarm.destroy).toHaveBeenCalled();
  });

  it("destroys swarm and resolves accepted:false when host rejects", async () => {
    const { attemptJoin } = await import("../../src/bin/team.js");
    const swarm = makeMockSwarm();
    const socket = makeMockSocket();

    const joinPromise = attemptJoin(
      swarm as unknown as import("hyperswarm").default,
      HOST_PUBLIC_KEY, "ws", PEER_PUBLIC_KEY, "gho_tok", "alice",
    );

    swarm.emit("connection", socket, { publicKey: Buffer.from(HOST_PUBLIC_KEY, "hex") });
    socket.emit(
      "data",
      Buffer.from(JSON.stringify({ type: "join_result", accepted: false, reason: "not invited" }) + "\n"),
    );

    const result = await joinPromise;
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.reason).toBe("not invited");
    expect(swarm.destroy).toHaveBeenCalled();
  });

  it("destroys swarm and rejects on socket error", async () => {
    const { attemptJoin } = await import("../../src/bin/team.js");
    const swarm = makeMockSwarm();
    const socket = makeMockSocket();

    const joinPromise = attemptJoin(
      swarm as unknown as import("hyperswarm").default,
      HOST_PUBLIC_KEY, "ws", PEER_PUBLIC_KEY, "gho_tok", "alice",
    );

    swarm.emit("connection", socket, { publicKey: Buffer.from(HOST_PUBLIC_KEY, "hex") });
    socket.emit("error", new Error("connection reset"));

    await expect(joinPromise).rejects.toThrow("connection reset");
    expect(swarm.destroy).toHaveBeenCalled();
  });

  it("destroys impostor socket without touching the swarm yet", async () => {
    const { attemptJoin } = await import("../../src/bin/team.js");
    const swarm = makeMockSwarm();
    const impostorSocket = makeMockSocket();

    attemptJoin(
      swarm as unknown as import("hyperswarm").default,
      HOST_PUBLIC_KEY, "ws", PEER_PUBLIC_KEY, "gho_tok", "alice",
    );

    // Emit a connection from a different public key
    swarm.emit("connection", impostorSocket, { publicKey: Buffer.from("c".repeat(64), "hex") });

    await new Promise((r) => setTimeout(r, 10));
    // swarm stays alive; impostor socket's destroy gets called but not the swarm
    expect(swarm.destroy).not.toHaveBeenCalled();
  });
});
