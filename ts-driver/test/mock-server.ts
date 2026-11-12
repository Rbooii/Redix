import net from "node:net";
import type { AddressInfo } from "node:net";
import { tryParseReply } from "../src/decoder.js";
import type { RespReply } from "../src/types.js";

export type MockServerHandler = (
  command: string[],
  socket: net.Socket,
  server: MockServer,
) => void | Promise<void>;

export class MockServer {
  readonly commands: string[][] = [];
  port = 0;
  connections = 0;

  private server: net.Server | null = null;
  private sockets = new Set<net.Socket>();
  private handlerChain: Promise<void> = Promise.resolve();

  constructor(private readonly handler: MockServerHandler) {}

  async start(port = 0): Promise<number> {
    const server = net.createServer((socket) => {
      this.connections++;
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));

      let inbox = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        inbox = Buffer.concat([inbox, chunk]);
        for (;;) {
          const parsed = tryParseReply(inbox);
          if (!parsed) {
            break;
          }
          inbox = inbox.subarray(parsed.consumed);
          const command = this.toCommand(parsed.reply);
          this.commands.push(command);
          this.handlerChain = this.handlerChain
            .then(() => this.handler(command, socket, this))
            .catch((error: unknown) => {
              socket.destroy(error instanceof Error ? error : undefined);
            });
        }
      });
    });

    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.port = (server.address() as AddressInfo).port;
    return this.port;
  }

  reply(socket: net.Socket, data: string): void {
    if (!socket.destroyed) {
      socket.write(data);
    }
  }

  dropConnections(): void {
    for (const socket of this.sockets) {
      socket.destroy();
    }
  }

  async stop(): Promise<void> {
    this.dropConnections();
    const server = this.server;
    this.server = null;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private toCommand(reply: RespReply): string[] {
    if (reply.type !== "array" || !reply.value) {
      throw new Error("expected a RESP array command");
    }
    return reply.value.map((item) => {
      if (item.type !== "bulk") {
        throw new Error("expected a RESP bulk string argument");
      }
      return item.value ?? "";
    });
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
