import { EventEmitter } from "node:events";
import type { BackoffOptions } from "./backoff.js";
import {
  Connection,
  type ConnectionState,
} from "./connection.js";
import { encodeCommand } from "./encoder.js";
import {
  RedixAuthError,
  RedixConnectionError,
  RedixError,
  RedixProtocolError,
  RedixQueueFullError,
  RedixServerError,
  RedixTimeoutError,
} from "./errors.js";
import type { RespReply } from "./types.js";

export interface RedixOptions extends Partial<BackoffOptions> {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  /**
   * Batas waktu per command dalam milidetik. 0 berarti tanpa timeout.
   * Timer mulai berjalan saat command masuk queue, bukan saat reply diterima.
   */
  commandTimeout?: number;
  /** Simpan command saat belum ready / reconnect. Default true. */
  offlineQueue?: boolean;
  /** Maksimum command yang boleh menunggu di offline queue. Default 1000. */
  maxOfflineQueue?: number;
}

export type RedixEvents = {
  ready: [];
  error: [Error];
  reconnecting: [number];
  close: [];
  state: [ConnectionState];
};

interface ResolvedOptions extends BackoffOptions {
  host: string;
  port: number;
  username: string;
  password?: string;
  commandTimeout: number;
  offlineQueue: boolean;
  maxOfflineQueue: number;
}

interface CommandRequest {
  args: readonly string[];
  resolve: (reply: RespReply) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
  settled: boolean;
}

export class Redix extends EventEmitter<RedixEvents> {
  private readonly config: ResolvedOptions;
  private connection: Connection | null = null;
  private pending: CommandRequest[] = [];
  private offline: CommandRequest[] = [];
  private sessionReady = false;
  private closed = false;
  private connectPromise: Promise<this> | null = null;
  private connectResolve: ((value: this) => void) | null = null;
  private connectReject: ((reason?: unknown) => void) | null = null;

  constructor(options: RedixOptions = {}) {
    super();
    this.config = {
      host: options.host ?? "127.0.0.1",
      port: options.port ?? 3333,
      username: options.username ?? "default",
      password: options.password,
      commandTimeout: options.commandTimeout ?? 0,
      offlineQueue: options.offlineQueue ?? true,
      maxOfflineQueue: options.maxOfflineQueue ?? 1000,
      initialReconnectDelay: options.initialReconnectDelay ?? 200,
      maxReconnectDelay: options.maxReconnectDelay ?? 3000,
      reconnectFactor: options.reconnectFactor ?? 2,
    };
  }

  get currentState(): ConnectionState {
    return this.closed ? "end" : (this.connection?.currentState ?? "idle");
  }

  get isReady(): boolean {
    return this.sessionReady;
  }

  connect(): Promise<this> {
    if (this.closed) {
      return Promise.reject(
        new RedixConnectionError("Client is closed", "CONNECTION_CLOSED"),
      );
    }
    if (this.sessionReady) {
      return Promise.resolve(this);
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<this>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });

    const connection = this.ensureConnection();
    void connection.connect().catch((error: unknown) => {
      this.handleDisconnect(error instanceof Error ? error : new Error(String(error)));
    });

    return this.connectPromise;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.sessionReady = false;
    const error = new RedixConnectionError("Client is closed", "CONNECTION_CLOSED");
    this.rejectConnect(error);
    this.rejectAll(error);

    const connection = this.connection;
    this.connection = null;
    if (!connection) {
      this.emit("close");
      return;
    }

    await new Promise<void>((resolve) => {
      connection.once("close", resolve);
      connection.close();
    });
  }

  sendCommand(args: readonly string[]): Promise<RespReply> {
    return this.request(args);
  }

  async ping(message?: string): Promise<string> {
    const reply = await this.sendCommand(
      message === undefined ? ["PING"] : ["PING", message],
    );
    return this.readString(reply, "PING");
  }

  async set(key: string, value: string): Promise<"OK"> {
    const reply = await this.sendCommand(["SET", key, value]);
    return this.expectSimple(reply, "SET", "OK") as "OK";
  }

  async get(key: string): Promise<string | null> {
    const reply = await this.sendCommand(["GET", key]);
    if (reply.type === "bulk") {
      return reply.value;
    }
    throw this.unexpectedReply(reply, "GET");
  }

  async del(key: string): Promise<number> {
    const reply = await this.sendCommand(["DEL", key]);
    return this.expectInteger(reply, "DEL");
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    if (!Number.isInteger(seconds) || seconds < 0) {
      throw new RedixError(
        `EXPIRE seconds must be a non-negative integer, got ${seconds}`,
        "INVALID_ARGUMENT",
      );
    }
    const reply = await this.sendCommand(["EXPIRE", key, String(seconds)]);
    return this.expectInteger(reply, "EXPIRE") === 1;
  }

  async bgrewriteaof(): Promise<"OK"> {
    const reply = await this.sendCommand(["BGREWRITEAOF"]);
    return this.expectSimple(reply, "BGREWRITEAOF", "OK") as "OK";
  }

  async select(database = 0): Promise<"OK"> {
    const reply = await this.sendCommand(["SELECT", String(database)]);
    return this.expectSimple(reply, "SELECT", "OK") as "OK";
  }

  async auth(password: string, username?: string): Promise<"OK"> {
    const args = username ? ["AUTH", username, password] : ["AUTH", password];
    const reply = await this.sendCommand(args);
    return this.expectSimple(reply, "AUTH", "OK") as "OK";
  }

  private request(args: readonly string[], internal = false): Promise<RespReply> {
    if (this.closed) {
      return Promise.reject(
        new RedixConnectionError("Client is closed", "CONNECTION_CLOSED"),
      );
    }
    if (args.length === 0) {
      return Promise.reject(
        new RedixError("Command cannot be empty", "INVALID_ARGUMENT"),
      );
    }

    return new Promise<RespReply>((resolve, reject) => {
      const request = this.createRequest(args, resolve, reject);

      if (!internal && (!this.sessionReady || !this.connection)) {
        this.enqueue(request);
        return;
      }

      if (!this.connection || this.connection.currentState !== "ready") {
        this.settle(
          request,
          new RedixConnectionError(
            "Connection is not ready",
            this.closed ? "CONNECTION_CLOSED" : "NOT_CONNECTED",
          ),
        );
        return;
      }

      this.dispatch(request);
    });
  }

  private ensureConnection(): Connection {
    if (this.connection) {
      return this.connection;
    }

    const connection = new Connection({
      host: this.config.host,
      port: this.config.port,
      initialReconnectDelay: this.config.initialReconnectDelay,
      maxReconnectDelay: this.config.maxReconnectDelay,
      reconnectFactor: this.config.reconnectFactor,
    });
    this.connection = connection;

    connection.on("ready", () => {
      void this.handleReady();
    });
    connection.on("reply", (reply) => {
      this.handleReply(reply);
    });
    connection.on("disconnect", (error) => {
      this.handleDisconnect(error);
    });
    connection.on("error", (error) => {
      this.emitError(error);
    });
    connection.on("reconnecting", (delay) => {
      this.sessionReady = false;
      this.emit("reconnecting", delay);
    });
    connection.on("state", (state) => {
      this.emit("state", state);
    });
    connection.on("close", () => {
      this.sessionReady = false;
      this.emit("close");
    });

    return connection;
  }

  private async handleReady(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.sessionReady = false;

    if (this.config.password) {
      try {
        const args =
          this.config.username !== "default"
            ? ["AUTH", this.config.username, this.config.password]
            : ["AUTH", this.config.password];
        await this.request(args, true);
      } catch (error) {
        if (error instanceof RedixConnectionError) {
          // Socket putus lagi. Reconnect berikutnya akan mengulang handshake.
          return;
        }

        const authError =
          error instanceof RedixServerError
            ? new RedixAuthError(error.reply, { cause: error })
            : error instanceof Error
              ? error
              : new Error(String(error));
        this.fatal(authError);
        return;
      }
    }

    this.sessionReady = true;
    this.flushOffline();
    this.emit("ready");
    this.resolveConnect();
  }

  private handleReply(reply: RespReply): void {
    const request = this.pending.shift();
    if (!request) {
      this.emitError(
        new RedixProtocolError("Received a reply without a pending command"),
      );
      return;
    }

    if (request.settled) {
      return;
    }

    if (reply.type === "error") {
      this.settle(request, new RedixServerError(reply.value));
    } else {
      this.settle(request, null, reply);
    }
  }

  private handleDisconnect(error: Error | null): void {
    if (this.closed) {
      return;
    }

    this.sessionReady = false;
    this.rejectPending(
      new RedixConnectionError(
        error ? `Connection lost: ${error.message}` : "Connection lost",
        "CONNECTION_LOST",
        error ? { cause: error } : undefined,
      ),
    );
  }

  private enqueue(request: CommandRequest): void {
    if (!this.config.offlineQueue) {
      this.settle(
        request,
        new RedixConnectionError("Offline queue is disabled", "NOT_CONNECTED"),
      );
      return;
    }

    if (this.offline.length >= this.config.maxOfflineQueue) {
      this.settle(
        request,
        new RedixQueueFullError(
          `Offline queue is full (max ${this.config.maxOfflineQueue})`,
        ),
      );
      return;
    }

    this.offline.push(request);
  }

  private flushOffline(): void {
    while (this.sessionReady && this.offline.length > 0) {
      const request = this.offline.shift();
      if (!request || request.settled) {
        continue;
      }
      this.dispatch(request);
    }
  }

  private dispatch(request: CommandRequest): void {
    if (!this.connection || this.connection.currentState !== "ready") {
      this.offline.unshift(request);
      return;
    }

    this.pending.push(request);
    try {
      this.connection.write(encodeCommand(request.args));
    } catch (error) {
      const index = this.pending.indexOf(request);
      if (index !== -1) {
        this.pending.splice(index, 1);
      }
      this.settle(
        request,
        new RedixConnectionError(
          `Failed to send ${this.describe(request.args)}`,
          "CONNECTION_LOST",
          error instanceof Error ? { cause: error } : undefined,
        ),
      );
    }
  }

  private createRequest(
    args: readonly string[],
    resolve: (reply: RespReply) => void,
    reject: (error: Error) => void,
  ): CommandRequest {
    const request: CommandRequest = {
      args,
      resolve,
      reject,
      timer: null,
      settled: false,
    };

    if (this.config.commandTimeout > 0) {
      request.timer = setTimeout(() => {
        const offlineIndex = this.offline.indexOf(request);
        if (offlineIndex !== -1) {
          this.offline.splice(offlineIndex, 1);
        }
        this.settle(
          request,
          new RedixTimeoutError(
            `${this.describe(args)} timed out after ${this.config.commandTimeout}ms`,
          ),
        );
      }, this.config.commandTimeout);
      request.timer.unref();
    }

    return request;
  }

  private settle(
    request: CommandRequest,
    error: Error | null,
    reply?: RespReply,
  ): void {
    if (request.timer) {
      clearTimeout(request.timer);
      request.timer = null;
    }
    if (request.settled) {
      return;
    }

    request.settled = true;
    if (error) {
      request.reject(error);
    } else {
      request.resolve(reply as RespReply);
    }
  }

  private rejectPending(error: Error): void {
    const pending = this.pending;
    this.pending = [];
    for (const request of pending) {
      this.settle(request, error);
    }
  }

  private rejectAll(error: Error): void {
    this.rejectPending(error);

    const offline = this.offline;
    this.offline = [];
    for (const request of offline) {
      this.settle(request, error);
    }
  }

  private fatal(error: Error): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.sessionReady = false;
    this.rejectConnect(error);
    this.rejectAll(error);
    this.emitError(error);

    const connection = this.connection;
    this.connection = null;
    if (!connection) {
      this.emit("close");
      return;
    }

    connection.close();
  }

  private resolveConnect(): void {
    const resolve = this.connectResolve;
    this.connectResolve = null;
    this.connectReject = null;
    this.connectPromise = null;
    resolve?.(this);
  }

  private rejectConnect(error: Error): void {
    const reject = this.connectReject;
    this.connectResolve = null;
    this.connectReject = null;
    this.connectPromise = null;
    reject?.(error);
  }

  private emitError(error: Error): void {
    if (this.listenerCount("error") > 0) {
      this.emit("error", error);
    }
  }

  private expectSimple(
    reply: RespReply,
    command: string,
    expected?: string,
  ): string {
    if (reply.type !== "simple") {
      throw this.unexpectedReply(reply, command);
    }
    if (expected !== undefined && reply.value !== expected) {
      throw new RedixProtocolError(
        `${command} expected +${expected}, got +${reply.value}`,
      );
    }
    return reply.value;
  }

  private expectInteger(reply: RespReply, command: string): number {
    if (reply.type !== "integer") {
      throw this.unexpectedReply(reply, command);
    }
    return reply.value;
  }

  private readString(reply: RespReply, command: string): string {
    if (reply.type === "simple" || reply.type === "bulk") {
      return reply.value ?? "";
    }
    throw this.unexpectedReply(reply, command);
  }

  private unexpectedReply(reply: RespReply, command: string): RedixProtocolError {
    return new RedixProtocolError(
      `${command} expected a different reply type, got ${reply.type}`,
    );
  }

  private describe(args: readonly string[]): string {
    const command = args[0]?.toUpperCase() ?? "COMMAND";
    return args.length > 1 ? `${command} ${args.slice(1).join(" ")}` : command;
  }
}

export { Redix as RedixClient };
export default Redix;
