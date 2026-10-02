import { EventEmitter } from "node:events";
import net from "node:net";
import { computeReconnectDelay, type BackoffOptions } from "./backoff.js";
import { tryParseReply } from "./decoder.js";
import type { RespReply } from "./types.js";

export type ConnectionState =
  | "idle" | "connecting" | "ready" | "reconnecting" | "closing" | "end";

export interface ConnectionOptions extends BackoffOptions {
  host: string;
  port: number;
}

export type ConnectionEvents = {
  ready: [];
  reply: [RespReply];
  error: [Error];
  reconnecting: [number];
  close: [];
  state: [ConnectionState];
};

export class Connection extends EventEmitter<ConnectionEvents> {
  private socket: net.Socket | null = null;
  private state: ConnectionState = "idle";
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private inbox = Buffer.alloc(0);
  private manuallyClosed = false;
  private connectPromise: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;

  constructor(private readonly options: ConnectionOptions) {
    super();
  }

  get currentState(): ConnectionState {
    return this.state;
  }

  connect(): Promise<void> {
    if (this.state === "ready") return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    this.manuallyClosed = false;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });

    if (this.state === "idle" || this.state === "end") this.openSocket();
    return this.connectPromise;
  }

  close(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectConnect(new Error("Connection closed before ready"));
    this.setState("closing");

    if (this.socket) {
      this.socket.destroy();
    } else {
      this.setState("end");
      this.emit("close");
    }
  }

  write(bytes: Buffer): void {
    if (!this.socket || this.state !== "ready") {
      throw new Error("Connection is not ready");
    }
    this.socket.write(bytes);
  }

  private openSocket(): void {
    this.setState("connecting");
    this.inbox = Buffer.alloc(0);

    const socket = net.createConnection({
      host: this.options.host,
      port: this.options.port,
    });
    socket.setNoDelay(true);
    this.socket = socket;

    socket.on("connect", () => {
      this.attempt = 0;
      this.setState("ready");
      this.emit("ready");
      const resolve = this.connectResolve;
      this.connectResolve = null;
      this.connectReject = null;
      this.connectPromise = null;
      resolve?.();
    });

    socket.on("data", (chunk: Buffer) => {
      this.inbox = Buffer.concat([this.inbox, chunk]);
      for (;;) {
        const parsed = tryParseReply(this.inbox);
        if (!parsed) break;
        this.inbox = this.inbox.subarray(parsed.consumed);
        this.emit("reply", parsed.reply);
      }
    });

    socket.on("error", (err: Error) => {
      this.emit("error", err);
    });

    socket.on("close", () => {
      this.socket = null;
      if (this.manuallyClosed) {
        this.setState("end");
        this.emit("close");
      } else {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    this.setState("reconnecting");
    const delay = computeReconnectDelay(this.attempt, this.options);
    this.attempt++;
    this.emit("reconnecting", delay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private setState(next: ConnectionState): void {
    this.state = next;
    this.emit("state", next);
  }

  private rejectConnect(err: Error): void {
    const reject = this.connectReject;
    this.connectReject = null;
    this.connectResolve = null;
    this.connectPromise = null;
    reject?.(err);
  }
}