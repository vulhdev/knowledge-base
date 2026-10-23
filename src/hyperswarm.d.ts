declare module "hyperdht" {
  interface DHTOptions {
    bootstrap?: { host: string; port: number }[];
    firewalled?: boolean;
  }
  export default class HyperDHT {
    constructor(options?: DHTOptions);
    destroy(): Promise<void>;
  }
}

declare module "hyperswarm" {
  import { EventEmitter } from "node:events";

  interface KeyPair {
    publicKey: Buffer;
    secretKey: Buffer;
  }

  interface HyperswarmOptions {
    keyPair?: KeyPair;
    firewall?: (remotePublicKey: Buffer) => boolean;
    maxPeers?: number;
    seed?: Buffer;
    bootstrap?: { host: string; port: number }[];
    dht?: object;
  }

  interface PeerInfo {
    publicKey: Buffer;
    topics: Buffer[];
  }

  class Hyperswarm extends EventEmitter {
    constructor(opts?: HyperswarmOptions);
    join(topic: Buffer, opts?: { server?: boolean; client?: boolean }): void;
    leave(topic: Buffer): Promise<void>;
    destroy(): Promise<void>;
    on(event: "connection", listener: (socket: NodeJS.ReadWriteStream, info: PeerInfo) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export default Hyperswarm;
}
