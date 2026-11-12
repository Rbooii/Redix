import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import {
  Redix,
  RedixAuthError,
  RedixConnectionError,
  RedixQueueFullError,
  RedixServerError,
  RedixTimeoutError,
  type RedixOptions,
} from "../src/index.js";
import { MockServer, delay } from "./mock-server.js";

function createClient(port: number, options: Partial<RedixOptions> = {}): Redix {
  return new Redix({
    host: "127.0.0.1",
    port,
    initialReconnectDelay: 10,
    maxReconnectDelay: 20,
    reconnectFactor: 1,
    ...options,
  });
}

test("typed API: set, get, del, expire, ping, bgrewriteaof", async (t) => {
  const store = new Map<string, string>();
  const server = new MockServer((command, socket, mock) => {
    const name = command[0].toUpperCase();
    if (name === "SET") {
      store.set(command[1], command[2]);
      mock.reply(socket, "+OK\r\n");
    } else if (name === "GET") {
      const value = store.get(command[1]);
      mock.reply(
        socket,
        value === undefined ? "$-1\r\n" : `$${Buffer.byteLength(value)}\r\n${value}\r\n`,
      );
    } else if (name === "DEL") {
      mock.reply(socket, store.delete(command[1]) ? ":1\r\n" : ":0\r\n");
    } else if (name === "EXPIRE") {
      mock.reply(socket, ":1\r\n");
    } else if (name === "PING") {
      mock.reply(
        socket,
        command[1] === undefined
          ? "+PONG\r\n"
          : `$${Buffer.byteLength(command[1])}\r\n${command[1]}\r\n`,
      );
    } else if (name === "BGREWRITEAOF") {
      mock.reply(socket, "+OK\r\n");
    } else if (name === "SELECT") {
      mock.reply(socket, "+OK\r\n");
    } else {
      mock.reply(socket, `-ERR unknown command '${command[0]}'\r\n`);
    }
  });

  const port = await server.start();
  const client = createClient(port);
  t.after(async () => {
    await client.close();
    await server.stop();
  });

  await client.connect();
  assert.equal(await client.set("name", "arco"), "OK");
  assert.equal(await client.get("name"), "arco");
  assert.equal(await client.get("missing"), null);
  assert.equal(await client.del("name"), 1);
  assert.equal(await client.del("name"), 0);
  assert.equal(await client.expire("name", 60), true);
  assert.equal(await client.ping(), "PONG");
  assert.equal(await client.ping("hello"), "hello");
  assert.equal(await client.bgrewriteaof(), "OK");
  assert.equal(await client.select(0), "OK");

  const raw = await client.sendCommand(["PING"]);
  assert.deepEqual(raw, { type: "simple", value: "PONG" });
});

test("offline queue: command sebelum connect dieksekusi setelah ready", async (t) => {
  const server = new MockServer((command, socket, mock) => {
    if (command[0].toUpperCase() === "SET") {
      mock.reply(socket, "+OK\r\n");
    }
  });
  const port = await server.start();
  const client = createClient(port);
  t.after(async () => {
    await client.close();
    await server.stop();
  });

  const queued = client.set("queued", "yes");
  await client.connect();
  assert.equal(await queued, "OK");
  assert.deepEqual(server.commands[0], ["SET", "queued", "yes"]);
});

test("pipeline: reply FIFO dan semua promise kebagian", async (t) => {
  const store = new Map<string, string>();
  const server = new MockServer((command, socket, mock) => {
    const name = command[0].toUpperCase();
    if (name === "SET") {
      store.set(command[1], command[2]);
      mock.reply(socket, "+OK\r\n");
    } else if (name === "GET") {
      const value = store.get(command[1]) ?? "";
      mock.reply(socket, `$${Buffer.byteLength(value)}\r\n${value}\r\n`);
    } else if (name === "DEL") {
      mock.reply(socket, ":1\r\n");
    }
  });
  const port = await server.start();
  const client = createClient(port);
  t.after(async () => {
    await client.close();
    await server.stop();
  });

  await client.connect();
  const [setReply, getReply, delReply] = await Promise.all([
    client.set("pipeline", "1"),
    client.get("pipeline"),
    client.del("pipeline"),
  ]);

  assert.equal(setReply, "OK");
  assert.equal(getReply, "1");
  assert.equal(delReply, 1);
  assert.deepEqual(
    server.commands.map((command) => command[0]),
    ["SET", "GET", "DEL"],
  );
});

test("disconnect: in-flight reject, offline queue selamat", async (t) => {
  let firstGet = true;
  const server = new MockServer((command, socket, mock) => {
    const name = command[0].toUpperCase();
    if (name === "GET" && firstGet) {
      firstGet = false;
      socket.destroy();
      return;
    }
    if (name === "SET") {
      mock.reply(socket, "+OK\r\n");
    } else if (name === "PING") {
      mock.reply(socket, "+PONG\r\n");
    }
  });
  const port = await server.start();
  const client = createClient(port);
  t.after(async () => {
    await client.close();
    await server.stop();
  });

  await client.connect();
  const reconnecting = once(client, "reconnecting");
  const ready = once(client, "ready");
  const inFlight = client.get("lost");

  await assert.rejects(
    inFlight,
    (error: unknown) => error instanceof RedixConnectionError,
  );
  await reconnecting;

  const queued = client.set("kept", "yes");
  await ready;
  assert.equal(await queued, "OK");
  assert.equal(await client.ping(), "PONG");
});

test("timeout: late reply tidak menggeser queue", async (t) => {
  const server = new MockServer(async (command, socket, mock) => {
    const name = command[0].toUpperCase();
    if (name === "PING") {
      await delay(150);
      mock.reply(socket, "+PONG\r\n");
    } else if (name === "GET") {
      mock.reply(socket, "$2\r\nok\r\n");
    }
  });
  const port = await server.start();
  const client = createClient(port, { commandTimeout: 100 });
  t.after(async () => {
    await client.close();
    await server.stop();
  });

  await client.connect();
  await assert.rejects(client.ping(), RedixTimeoutError);
  assert.equal(await client.get("k"), "ok");
});

test("auth otomatis sebelum command di queue", async (t) => {
  const authenticated = new Set<net.Socket>();
  const server = new MockServer((command, socket, mock) => {
    const name = command[0].toUpperCase();
    if (name === "AUTH") {
      const user = command.length === 3 ? command[1] : "default";
      const password = command[command.length - 1];
      if (user === "default" && password === "secret") {
        authenticated.add(socket);
        mock.reply(socket, "+OK\r\n");
      } else {
        mock.reply(socket, "-WRONGPASS invalid username-password pair\r\n");
      }
      return;
    }

    if (!authenticated.has(socket)) {
      mock.reply(socket, "-NOAUTH Authentication required.\r\n");
      return;
    }

    if (name === "SET") {
      mock.reply(socket, "+OK\r\n");
    }
  });
  const port = await server.start();
  const client = createClient(port, { password: "secret" });
  t.after(async () => {
    await client.close();
    await server.stop();
  });

  const queued = client.set("auth", "ok");
  await client.connect();
  assert.equal(await queued, "OK");
  assert.deepEqual(
    server.commands.map((command) => command[0]),
    ["AUTH", "SET"],
  );
});

test("auth salah -> RedixAuthError", async (t) => {
  const server = new MockServer((command, socket, mock) => {
    if (command[0].toUpperCase() === "AUTH") {
      mock.reply(socket, "-WRONGPASS invalid username-password pair\r\n");
    }
  });
  const port = await server.start();
  const client = createClient(port, { password: "wrong" });
  t.after(async () => {
    await client.close();
    await server.stop();
  });

  await assert.rejects(
    client.connect(),
    (error: unknown) =>
      error instanceof RedixAuthError &&
      error.code === "AUTH_FAILED" &&
      error.prefix === "WRONGPASS",
  );
  assert.equal(client.isReady, false);
});

test("server error -> RedixServerError", async (t) => {
  const server = new MockServer((command, socket, mock) => {
    if (command[0].toUpperCase() === "PING") {
      mock.reply(socket, "-NOAUTH Authentication required.\r\n");
    }
  });
  const port = await server.start();
  const client = createClient(port);
  t.after(async () => {
    await client.close();
    await server.stop();
  });

  await client.connect();
  await assert.rejects(
    client.ping(),
    (error: unknown) =>
      error instanceof RedixServerError &&
      error.code === "NOAUTH" &&
      error.prefix === "NOAUTH",
  );
});

test("offline queue penuh -> RedixQueueFullError", async () => {
  const client = createClient(1, { maxOfflineQueue: 1 });
  const first = client.set("a", "b");
  first.catch(() => {});

  await assert.rejects(client.ping(), RedixQueueFullError);

  await client.close();
  await assert.rejects(first, RedixConnectionError);
});

test("offline queue disabled -> langsung reject", async () => {
  const client = createClient(1, { offlineQueue: false });
  await assert.rejects(client.set("a", "b"), RedixConnectionError);
  await client.close();
});

test("close reject command yang masih menunggu reply", async (t) => {
  const server = new MockServer(() => {
    // sengaja tidak pernah membalas GET
  });
  const port = await server.start();
  const client = createClient(port);
  t.after(async () => {
    await client.close();
    await server.stop();
  });

  await client.connect();
  const inFlight = client.get("never");
  const rejected = assert.rejects(inFlight, RedixConnectionError);
  await delay(20);
  await client.close();
  await rejected;
});
