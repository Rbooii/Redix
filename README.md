# Redix
<img src="./readme-assets/redix-logo-dark.png" width="100" height="100" alt="redix logo">


A small in-memory key-value store built from scratch in C++, inspired by Redis. This is a learning project focused on understanding how a database like Redis actually works under the hood: storage, hashing, networking, and the event loop that ties it all together.

## Why this exists

I wanted to go past "using" Redis and actually build something that behaves like it. The goal isn't to replace Redis, it's to understand the pieces: how key-value storage works with a hash map, how TCP sockets accept and read client connections, and how a single-threaded event loop can handle many clients without spawning a thread per connection (the same core idea Redis itself uses).

The project started in C++ as a way to practice programming (rare btw in this ai era) while learning networking, but the guide this project follows ([build-your-own.org/redis](https://build-your-own.org/redis/)) but i only follow it for the networking thing, for the coreDB/ The data structures. im pretty much on my own lol.

## Current state

Currently, the server speaks RESP (Redis Serialization Protocol) over a kqueue-based event loop (macOS/BSD). Data lives in a custom-built Hash Map using separate chaining with incremental rehashing, while expiry is tracked in an AVL tree keyed by timestamp, powering TTL with both lazy checks on GET and active sweeps in the event loop. Persistence is append-only (AOF): writes are queued to a background worker thread, and BGREWRITEAOF / graceful shutdown compacts the log. Supported commands currently include SET, GET, DEL, EXPIRE, and BGREWRITEAOF. The next step is making the event loop cross-platform (poll/epoll on Linux).

## Requirements

- A C++ compiler with C++20 support. `clang++` works fine.
- CMake 3.20 or newer
- macOS/BSD for now (the event loop uses `kqueue`)

On macOS, both can be installed with Homebrew:

```bash
brew install cmake
```

## Building and running

```bash
cmake -B build
cmake --build build
./build/redix-server -> server binary
./build/redix-client PORT -> client binary to connect to a specific port eg ./build/redix-client 3333
```

- `cmake -B build` generates the build files. You only need to rerun this if `CMakeLists.txt` changes.
- `cmake --build build` compiles the project. Run this every time you change the code.
- `./build/redix` is a placeholder dev binary (currently a hello world); the real entrypoints are `redix-server` and `redix-client` above.

or simpy just run
`make` or `make full` (`make full` configures + builds, `make` only builds)

### Server flags

- `-p <port>` set the listening port (default 3333)
- `-r [0|1]` reset (truncate) the AOF file before loading
- `-d <path>` override the AOF persistence file path


## Roadmap

- [x] In-memory key-value store with SET/GET/DEL (written in C++, briefly rewritten in C, then back to C++)
- [x] TCP server using raw sockets
- [x] RESP (Redis Serialization Protocol) request-response and command parsing
- [x] kqueue-based event loop for handling multiple clients
- [x] Custom Hash Map with separate chaining and incremental rehashing
- [x] TTL / key expiry (AVL tree with lazy + active expiration)
- [x] Async AOF persistence (background writer + compaction/rewrite)
- [x] add Authentication
- [ ] Make a driver for Typescript usage
