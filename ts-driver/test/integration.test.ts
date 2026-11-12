import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Redix, RedixAuthError } from "../src/index.js";

const SERVER_BIN = process.env.REDIX_SERVER_BIN;

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForServer(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`redix-server exited early with code ${child.exitCode}`);
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port });
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", reject);
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("redix-server did not start in time");
}

async function startServer(extraArgs: string[] = []): Promise<{
  child: ChildProcess;
  port: number;
  directory: string;
}> {
  if (!SERVER_BIN) {
    throw new Error("REDIX_SERVER_BIN is not set");
  }

  const directory = await mkdtemp(join(tmpdir(), "redix-integration-"));
  const port = await freePort();
  const aof = join(directory, "redix.aof");
  const child = spawn(
    SERVER_BIN,
    ["-p", String(port), "-d", aof, "-r", "1", ...extraArgs],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout?.resume();
  child.stderr?.resume();

  try {
    await waitForServer(port, child);
  } catch (error) {
    child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  return { child, port, directory };
}

async function stopServer(
  child: ChildProcess,
  directory: string,
): Promise<void> {
  if (child.exitCode === null) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
  await rm(directory, { recursive: true, force: true });
}

test("integration: real redix-server", { skip: !SERVER_BIN }, async (t) => {
  const { child, port, directory } = await startServer();
  const client = new Redix({
    host: "127.0.0.1",
    port,
    initialReconnectDelay: 20,
    maxReconnectDelay: 50,
    reconnectFactor: 1,
  });
  t.after(async () => {
    await client.close();
    await stopServer(child, directory);
  });

  await client.connect();
  assert.equal(await client.ping(), "PONG");
  assert.equal(await client.set("integration", "works"), "OK");
  assert.equal(await client.get("integration"), "works");
  assert.equal(await client.expire("integration", 60), true);
  assert.equal(await client.del("integration"), 1);
  assert.equal(await client.get("integration"), null);
});

test("integration: auth with --requirepass", { skip: !SERVER_BIN }, async (t) => {
  const { child, port, directory } = await startServer(["--requirepass", "secret"]);
  const client = new Redix({
    host: "127.0.0.1",
    port,
    password: "secret",
    initialReconnectDelay: 20,
    maxReconnectDelay: 50,
    reconnectFactor: 1,
  });
  const wrong = new Redix({
    host: "127.0.0.1",
    port,
    password: "wrong",
    initialReconnectDelay: 20,
    maxReconnectDelay: 50,
    reconnectFactor: 1,
  });
  t.after(async () => {
    await client.close();
    await wrong.close();
    await stopServer(child, directory);
  });

  await client.connect();
  assert.equal(await client.set("auth", "ok"), "OK");
  assert.equal(await client.get("auth"), "ok");

  await assert.rejects(
    wrong.connect(),
    (error: unknown) => error instanceof RedixAuthError,
  );
});
