# Redix
<img src="./readme-assets/redix-logo-dark.png" width="100" height="100" alt="redix logo">


A small in-memory key-value store built from scratch in C++, inspired by Redis. This is a learning project focused on understanding how a database like Redis actually works under the hood: storage, hashing, networking, and the event loop that ties it all together.

## Why this exists

I wanted to go past "using" Redis and actually build something that behaves like it. The goal isn't to replace Redis, it's to understand the pieces: how key-value storage works with a hash map, how TCP sockets accept and read client connections, and how a single-threaded event loop can handle many clients without spawning a thread per connection (the same core idea Redis itself uses).

The project started in C++ as a way to practice OOP while learning networking, but the guide this project follows ([build-your-own.org/redis](https://build-your-own.org/redis/)) but i only follow it for the networking thing, for the coreDB/ The data structures. im pretty much on my own lol.

## Current state

Currently, the server is fully functional for basic database operations. It parses client data streams into actionable commands and executes them against a custom-built, memory-safe Hash Map (implementing separate chaining). Supported commands currently include GET, SET, and DEL. The next step is to implement Incremental Rehashing to handle Hash Map resizing, followed by an AVL Tree for TTL/expiry features.

## Requirements

- A C++ compiler with C++17 support or newer. `clang++` works fine.
- CMake 3.20 or newer

On macOS, both can be installed with Homebrew:

```bash
brew install cmake
```

## Building and running

```bash
cmake -B build
cmake --build build
./build/redix -> //main binary (still development)
```

### client server run
```bash
make full or make
./build/redix-server -> server binary
./build/redix-client PORT -> client binary to connect to a specific port eg ./build/redix-client 3333
```


- `cmake -B build` generates the build files. You only need to rerun this if `CMakeLists.txt` changes.
- `cmake --build build` compiles the project. Run this every time you change the code.
- `./build/redix` runs the compiled binary.

or simpy just run
`make` or `make full`


## Roadmap

- [x] In-memory key-value store with set/get/del (originally C++, later reimplemented in C)
- [x] TCP server using raw sockets
- [x] Request-response protocol (length-prefixed messages)
- [x] Event loop for handling multiple clients
- [x] Basic command protocol (parsing text commands from clients streams)
- [x] Implement Data structures (hashmap) for stroing key and values efficiently
- [x] In-memory key-value store with SET/GET/DEL using a custom Hash Map
- [x] TTL / key expiry
- [x] Simple persistence (snapshot to disk)
