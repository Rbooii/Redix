# Redix
<img src="./readme-assets/redix-logo-dark.png" width="100" height="100" alt="redix logo">


A small in-memory key-value store built from scratch in C++, inspired by Redis. This is a learning project focused on understanding how a database like Redis actually works under the hood: storage, hashing, networking, and the event loop that ties it all together.

## Why this exists

I wanted to go past "using" Redis and actually build something that behaves like it. The goal isn't to replace Redis, it's to understand the pieces: how key-value storage works with a hash map, how TCP sockets accept and read client connections, and how a single-threaded event loop can handle many clients without spawning a thread per connection (the same core idea Redis itself uses).

The project started in C++ as a way to practice programming (rare btw in this ai era) while learning networking, but the guide this project follows ([build-your-own.org/redis](https://build-your-own.org/redis/)) but i only follow it for the networking thing, for the coreDB/ The data structures. im pretty much on my own lol.

## Current state

Currently, the server speaks RESP (Redis Serialization Protocol) over a kqueue-based event loop on macOS/BSD and an epoll-based event loop on Linux. Data lives in a custom-built Hash Map using separate chaining with incremental rehashing, while expiry is tracked in an AVL tree keyed by timestamp, powering TTL with both lazy checks on GET and active sweeps in the event loop. Persistence is append-only (AOF): writes are queued to a background worker thread, and BGREWRITEAOF / graceful shutdown compacts the log. Supported commands currently include SET, GET, DEL, EXPIRE, PING, AUTH, SELECT, CLIENT, and BGREWRITEAOF. There's also a TypeScript driver, a Docker image, and a CI pipeline for Linux + macOS.

## Requirements

- A C++ compiler with C++20 support. `clang++` and `g++` both work.
- CMake 3.20 or newer.
- macOS/BSD with `kqueue`, or Linux with `epoll`.
- Optional: Node.js 20 or newer for the TypeScript driver.
- Optional: Docker with a Linux container engine for the Docker setup.

On macOS, CMake can be installed with Homebrew:

```bash
brew install cmake
```

## Building and running

```bash
cmake -B build
cmake --build build

./build/redix-server              # server, default port 3333
./build/redix-client 3333         # built-in CLI client
```

- `cmake -B build` generates the build files. You only need to rerun this if `CMakeLists.txt` changes.
- `cmake --build build` compiles the project. Run this every time you change the code.
- `./build/redix` is a placeholder dev binary (currently a hello world); the real entrypoints are `redix-server` and `redix-client` above.
- The server creates `./redix.aof` by default.

Or simply run:

```bash
make       # build only
make full  # configure + build
```

### Server flags

- `-p <port>` set the listening port (default `3333`)
- `-r [0|1]` reset (truncate) the AOF file before loading
- `-d <path>` override the AOF persistence file path
- `--requirepass <password>` enable authentication with the given password

Examples:

```bash
./build/redix-server -p 4444
./build/redix-server -p 4444 -d ./data/redix.aof
./build/redix-server -p 4444 --requirepass secret
./build/redix-server -p 4444 -r 1   # nuke the AOF before starting
```

## Connecting to the server

### Built-in client

```bash
./build/redix-server
./build/redix-client 3333
```

The built-in client connects to `127.0.0.1` and sends commands as RESP. It does not authenticate automatically, so if the server uses `--requirepass`, type `AUTH secret` first.

### redis-cli

Redix speaks RESP, so `redis-cli` can talk to it:

```bash
redis-cli -p 3333
```

```text
127.0.0.1:3333> SET name arco
OK
127.0.0.1:3333> GET name
"arco"
127.0.0.1:3333> GET missing
(nil)
127.0.0.1:3333> EXPIRE name 60
(integer) 1
127.0.0.1:3333> DEL name
(integer) 1
```

With authentication:

```bash
redis-cli -p 3333 -a secret --no-auth-warning
```

Or authenticate inside the shell:

```text
127.0.0.1:3333> AUTH secret
OK
```

Not every `redis-cli` convenience feature works. Redix only implements the commands below; things like `COMMAND DOCS`, `HELLO`, `QUIT`, transactions, and pub/sub are not there yet.

## Commands

| Command | Response | Notes |
| --- | --- | --- |
| `SET key value` | `+OK` | `NIL` and `ERR` are reserved keywords and rejected as values. |
| `GET key` | bulk string or `$-1` | Returns `nil` for missing or expired keys. |
| `DEL key` | `:1` or `:0` | Deletes one key at a time. |
| `EXPIRE key seconds` | `:1` or `:0` | Sets a TTL in seconds. `0` means it expires immediately. |
| `PING [message]` | `+PONG` or bulk string | With a message, the message is returned as a bulk string. |
| `AUTH [username] password` | `+OK` | Only the `default` user is supported. Requires `--requirepass`. |
| `BGREWRITEAOF` | `+OK` | Compacts the AOF file with the current dataset. |
| `SELECT 0` | `+OK` | Only database `0` exists. |
| `CLIENT SETNAME name` | `+OK` | Compatibility command. The name is not stored. |
| `CLIENT GETNAME` | empty bulk string | Compatibility command. |
| `CLIENT SETINFO key value` | `+OK` | Compatibility command used by some clients. |

Unknown commands return a RESP error, for example:

```text
-ERR unknown command 'INCR'
```

### TTL behavior

Expiry is tracked in an AVL tree ordered by timestamp. Expired keys are removed in two ways:

- lazily, when `GET` touches an expired key
- actively, from the event loop with a per-tick sweep limit

TTL is not a precise timer. A key can still exist in memory slightly past its expiry time until the next sweep, but commands that read it will treat it as gone.

### Authentication

Start the server with a password:

```bash
./build/redix-server --requirepass secret
```

Every command except `AUTH` (and a few handshake names) returns `-NOAUTH Authentication required.` until the connection authenticates.

```text
AUTH secret
AUTH default secret
```

The password comparison uses a constant-time compare. AUTH commands are not written to the AOF.

### Persistence (AOF)

Writes are appended as RESP commands. The server queues writes to a background worker thread so the main event loop does not block on the file.

- Default path: `./redix.aof`
- Override with `-d <path>`
- `-r 1` truncates the AOF before loading
- `BGREWRITEAOF` rewrites the AOF from the current in-memory dataset
- graceful shutdown also compacts the AOF

There is no `fsync` policy config yet. The background worker flushes its stream, but a machine crash can still lose the most recent writes.

## Using Redix from TypeScript

The driver lives in [`ts-driver/`](./ts-driver) and is ESM-only, has zero runtime dependencies, and requires Node.js 20 or newer.

### Build the package

```bash
cd ts-driver
npm install
npm run build
```

To use it from another local project, link it:

```bash
cd ts-driver
npm link

# from your own project
npm link redix-client
```

Or install the local folder after building:

```bash
npm install /path/to/Redix/ts-driver
```

### Quick start

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

AUTH is sent automatically after every connect and reconnect, before queued commands are flushed.

### Client options

| Option | Default | Description |
| --- | --- | --- |
| `host` | `127.0.0.1` | Server host. |
| `port` | `3333` | Server port. |
| `username` | `default` | Username for `AUTH username password`. |
| `password` | unset | Automatically authenticate. |
| `commandTimeout` | `0` | Timeout per command in ms. `0` disables it. |
| `offlineQueue` | `true` | Queue commands while disconnected. |
| `maxOfflineQueue` | `1000` | Max queued commands before rejecting with `RedixQueueFullError`. |
| `initialReconnectDelay` | `200` | First reconnect delay in ms. |
| `maxReconnectDelay` | `3000` | Reconnect delay cap in ms. |
| `reconnectFactor` | `2` | Exponential backoff factor. |

### Typed methods

```ts
await redix.connect(): Promise<Redix>
await redix.close(): Promise<void>

await redix.set(key: string, value: string): Promise<"OK">
await redix.get(key: string): Promise<string | null>
await redix.del(key: string): Promise<number>
await redix.expire(key: string, seconds: number): Promise<boolean>
await redix.ping(message?: string): Promise<string>
await redix.bgrewriteaof(): Promise<"OK">
await redix.select(database?: number): Promise<"OK">
await redix.auth(password: string, username?: string): Promise<"OK">

await redix.sendCommand(args: string[]): Promise<RespReply>
```

`sendCommand` is the raw escape hatch and still goes through the same queue and error handling:

```ts
const reply = await redix.sendCommand(["GET", "name"]);
// { type: "bulk", value: "arco" }
```

### Queue and reconnect behavior

- Replies are paired with commands in FIFO order, so pipelining works.
- Commands sent before `connect()` or while reconnecting stay in the offline queue and flush after the socket is ready.
- A command that was already written but has no reply yet is rejected with `RedixConnectionError` when the connection drops. It is not retried automatically, because the server might have executed it.
- A timed-out command leaves a placeholder in the reply queue. When the late reply arrives it is discarded, so it cannot shift the next command's response.
- `close()` rejects in-flight and queued commands with `CONNECTION_CLOSED`.

### Errors

| Class | Code | When |
| --- | --- | --- |
| `RedixConnectionError` | `CONNECTION_CLOSED`, `CONNECTION_LOST`, `NOT_CONNECTED` | Socket is closed, lost, or not ready. |
| `RedixTimeoutError` | `COMMAND_TIMEOUT` | Command exceeded `commandTimeout`. |
| `RedixQueueFullError` | `OFFLINE_QUEUE_FULL` | Offline queue reached `maxOfflineQueue`. |
| `RedixProtocolError` | `PROTOCOL_ERROR` | Unexpected or malformed RESP reply. |
| `RedixServerError` | server prefix, e.g. `ERR`, `NOAUTH` | Server returned a RESP error. |
| `RedixAuthError` | `AUTH_FAILED` | Automatic AUTH failed. `prefix` still has the server code, e.g. `WRONGPASS`. |

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

### Driver tests

```bash
cd ts-driver
npm run typecheck
npm test
npm run build
```

Integration tests spawn the real server when `REDIX_SERVER_BIN` is set:

```bash
REDIX_SERVER_BIN=../build/redix-server npm test
```

## Docker

The image builds and runs the Linux version of the server (epoll). On macOS, Docker Desktop / OrbStack / Colima are fine because they run a Linux container engine.

### Build and run

```bash
docker build -t redix .
docker run --rm -p 3333:3333 -v redix-data:/data redix
```

The default command is:

```text
redix-server -p 3333 -d /data/redix.aof
```

With authentication:

```bash
docker run --rm -p 3333:3333 -v redix-data:/data redix \
  -p 3333 -d /data/redix.aof --requirepass secret
```

Then connect from the host:

```bash
redis-cli -p 3333 ping
redis-cli -p 3333 -a secret --no-auth-warning ping
```

### Docker Compose

```bash
docker compose up --build
docker compose down
```

`compose.yaml` mounts the named volume `redix-data` at `/data`, maps port `3333`, and keeps the container restarting unless you stop it. For a password, uncomment the `--requirepass` command in the compose file and set `REDIX_PASSWORD`.

### Persistence and permissions

The AOF lives at `/data/redix.aof` inside the container. Use a Docker volume (like the compose file does) rather than a host bind mount if you do not want to deal with UID permissions. The container runs as UID `10001`, and SIGTERM is wired to the server's graceful shutdown path, so `docker stop` compacts the AOF before the process exits.

## CI / Pipeline

The GitHub Actions workflow lives in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml). It does build and test only; it does not publish images.

Jobs:

- **Driver** — Node 20 and 22, runs `npm ci`, typecheck, unit tests, and build.
- **Server** — Ubuntu and macOS, builds with CMake, runs the TypeScript driver integration tests against the real server, then smoke-tests `PING`.
- **Docker** — builds the image and runs a container smoke test after the native jobs pass.

Local equivalents:

```bash
# C++
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build

# Driver
cd ts-driver
npm ci
npm run typecheck
npm test
npm run build

# Real server integration
REDIX_SERVER_BIN=../build/redix-server npm test

# Container smoke test (after docker build/run)
REDIX_PORT=3333 node scripts/smoke-test.mjs
```

## Project layout

```text
src/
  server.cpp                 TCP listener + event loop
  client.cpp                 built-in CLI client
  utils/
    CoreDB.cpp               hash map, AVL TTL tree, AOF, command execution
    CoreIO.cpp               RESP parser + connection state
    CoreEventLoop.cpp        kqueue (macOS/BSD) and epoll (Linux) wrapper
    CoreDebug.cpp            server flags and logging
ts-driver/
  src/                       encoder, decoder, connection, client, errors
  test/                      unit tests, mock server, integration tests
Dockerfile
compose.yaml
scripts/smoke-test.mjs
```

## Known limitations

- Redix is not a drop-in Redis replacement. Only the commands listed above exist.
- The event loop is single-threaded. The AOF writer is the only background thread.
- Each client request buffer is around 4 KB (`MAX_MESSAGE_LEN = 4096`), so very large values do not fit.
- `SET` does not support `EX`, `NX`, or `XX`, and updating an existing key keeps its old TTL.
- Only database `0` exists.
- No transactions, pub/sub, scripting, `HELLO`, `QUIT`, or `RESET` yet.
- AOF has no configurable `fsync` policy.
- The TypeScript driver only exposes Redix commands, not the full Redis API.

## Roadmap

- [x] In-memory key-value store with SET/GET/DEL (written in C++, briefly rewritten in C, then back to C++)
- [x] TCP server using raw sockets
- [x] RESP (Redis Serialization Protocol) request-response and command parsing
- [x] kqueue-based event loop for handling multiple clients
- [x] Custom Hash Map with separate chaining and incremental rehashing
- [x] TTL / key expiry (AVL tree with lazy + active expiration)
- [x] Async AOF persistence (background writer + compaction/rewrite)
- [x] add Authentication
- [x] Make a driver for Typescript usage
- [x] Cross-platform event loop (kqueue on macOS/BSD, epoll on Linux)
- [x] Docker image + compose
- [x] CI pipeline for Linux, macOS, and the Docker image
- [ ] More Redis commands (TTL, INCR, MGET, etc.)
- [ ] Configurable AOF fsync policy

## Redix Typescript Client Roadmap

- [x]  Setup package.
- [x]  Encoder RESP.
- [x]  Decoder RESP (tersulit).
- [x]  Connection state machine + reconnect.
- [x]  Queue & Promise pairing + offline queue.
- [x]  API ber-tipe + error taxonomy.
- [x]  Tests, build, docs.
