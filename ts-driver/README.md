# redix-client

TypeScript driver for [Redix](../README.md), a small in-memory key-value store built from scratch in C++.

The driver speaks RESP directly over TCP. It is ESM-only, has zero runtime dependencies, and runs on Node.js 20 or newer.

## Build

```bash
cd ts-driver
npm install
npm run build
```

The compiled package goes to `dist/` and exposes `Redix` / `RedixClient` from the package entrypoint.

## Quick start

```ts
import { RedixClient } from "redix-client";

const redix = new RedixClient({
    host: "127.0.0.1",
    port: 3333,
});

await redix.connect();

await redix.set("name", "arco");
console.log(await redix.get("name")); // "arco"
console.log(await redix.ping());      // "PONG"

await redix.close();
```

With authentication:

```ts
const redix = new RedixClient({
    host: "127.0.0.1",
    port: 3333,
    password: "secret",
});

await redix.connect();
```

`AUTH` is sent automatically before any queued command is flushed. If the password is wrong, `connect()` rejects with `RedixAuthError`.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `host` | `127.0.0.1` | Server host. |
| `port` | `3333` | Server port. |
| `username` | `default` | Username for `AUTH username password`. |
| `password` | unset | Automatically authenticate after every connect/reconnect. |
| `commandTimeout` | `0` | Timeout per command in ms. `0` disables it. |
| `offlineQueue` | `true` | Queue commands while disconnected. |
| `maxOfflineQueue` | `1000` | Maximum queued commands before rejecting with `RedixQueueFullError`. |
| `initialReconnectDelay` | `200` | First reconnect delay in ms. |
| `maxReconnectDelay` | `3000` | Reconnect delay cap in ms. |
| `reconnectFactor` | `2` | Exponential backoff factor. |

## API

```ts
await redix.connect(): Promise<Redix>
await redix.close(): Promise<void>
await redix.ping(message?: string): Promise<string>
await redix.set(key: string, value: string): Promise<"OK">
await redix.get(key: string): Promise<string | null>
await redix.del(key: string): Promise<number>
await redix.expire(key: string, seconds: number): Promise<boolean>
await redix.bgrewriteaof(): Promise<"OK">
await redix.select(database?: number): Promise<"OK">
await redix.auth(password: string, username?: string): Promise<"OK">
await redix.sendCommand(args: string[]): Promise<RespReply>
```

`sendCommand` is the raw escape hatch. It still goes through the same queue, timeout, and error handling as the typed helpers.

```ts
const reply = await redix.sendCommand(["GET", "name"]);
// { type: "bulk", value: "arco" }
```

## Queue behavior

- Replies are paired with commands in FIFO order, so pipelining works.
- Commands sent before `connect()` (or while reconnecting) stay in the offline queue and are flushed after the socket is ready.
- A command that was already written but has no reply yet is rejected with `RedixConnectionError` when the connection drops. It is not retried automatically, because the server might have executed it.
- A command that times out stays as a placeholder in the reply queue. When the late reply arrives it is discarded, so it cannot shift the next command's response.
- `close()` rejects both in-flight and offline commands with `CONNECTION_CLOSED`.

## Errors

All driver errors extend `RedixError` and expose a `code` field.

| Class | Code | When |
| --- | --- | --- |
| `RedixConnectionError` | `CONNECTION_CLOSED`, `CONNECTION_LOST`, `NOT_CONNECTED` | Socket is closed, lost, or not ready. |
| `RedixTimeoutError` | `COMMAND_TIMEOUT` | Command exceeded `commandTimeout`. |
| `RedixQueueFullError` | `OFFLINE_QUEUE_FULL` | Offline queue reached `maxOfflineQueue`. |
| `RedixProtocolError` | `PROTOCOL_ERROR` | Unexpected or malformed RESP reply. |
| `RedixServerError` | server prefix, e.g. `ERR`, `NOAUTH` | Server returned a RESP error. |
| `RedixAuthError` | `AUTH_FAILED` | Automatic `AUTH` failed. Its `prefix` still contains the server code, e.g. `WRONGPASS`. |

```ts
import { RedixServerError } from "redix-client";

try {
    await redix.get("name");
} catch (error) {
    if (error instanceof RedixServerError) {
        console.log(error.code);  // "NOAUTH"
        console.log(error.reply); // full server error string
    }
}
```

## Tests

```bash
npm run typecheck
npm test
npm run build
```

The integration tests spawn a real server when `REDIX_SERVER_BIN` is set:

```bash
REDIX_SERVER_BIN=../build/redix-server npm test
```

## Notes

- This is not a drop-in replacement for `ioredis` or `node-redis`. It only exposes commands implemented by Redix.
- Requires an ESM project (`"type": "module"` or dynamic `import()`).
- Many Redis commands and options (transactions, pub/sub, scripting) do not exist in Redix yet.
