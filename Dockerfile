FROM debian:bookworm-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

COPY CMakeLists.txt ./
COPY src ./src
COPY legacy_cpp ./legacy_cpp

RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --target redix-server --parallel "$(nproc)"


FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home --home-dir /data --shell /usr/sbin/nologin redix \
    && mkdir -p /data \
    && chown -R redix:redix /data

COPY --from=build --chown=redix:redix /src/build/redix-server /usr/local/bin/redix-server

WORKDIR /data
USER redix

EXPOSE 3333
VOLUME ["/data"]
STOPSIGNAL SIGTERM

ENTRYPOINT ["redix-server"]
CMD ["-p", "3333", "-d", "/data/redix.aof"]
