cmake_minimum_required(VERSION 3.20)
project(RedisClone C CXX)

set(CMAKE_C_STANDARD 17)
set(CMAKE_C_STANDARD_REQUIRED ON)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

find_package(Threads REQUIRED)

add_executable(redix
    src/main.cpp
    src/utils/CoreDebug.cpp
    src/utils/CoreIO.cpp
    src/utils/CoreDB.cpp
)
target_include_directories(redix PRIVATE src src/utils)
target_link_libraries(redix PRIVATE Threads::Threads)

#server_dev
add_executable(redix-server
    src/server.cpp
    src/utils/CoreDebug.cpp
    src/utils/CoreEventLoop.cpp
    src/utils/CoreIO.cpp
    src/utils/CoreDB.cpp
)
target_include_directories(redix-server PRIVATE src src/utils)
target_link_libraries(redix-server PRIVATE Threads::Threads)

#client_dev
add_executable(redix-client
    src/client.cpp
    src/utils/CoreDebug.cpp
    src/utils/CoreIO.cpp
    src/utils/CoreDB.cpp
)
target_include_directories(redix-client PRIVATE src src/utils)
target_link_libraries(redix-client PRIVATE Threads::Threads)

# Legacy C++ prototype, kept for reference, excluded from default build
add_executable(legacy-server-test EXCLUDE_FROM_ALL
    legacy_cpp/server_test.cpp
)
target_include_directories(legacy-server-test PRIVATE legacy_cpp)