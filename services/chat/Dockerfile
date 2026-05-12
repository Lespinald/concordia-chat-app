# --- Builder Stage ---
# Pin to bookworm so the resulting binary links against the same glibc as the
# bookworm-slim runtime stage. Using bare `rust:slim` (currently trixie) would
# produce a binary that fails on bookworm with `GLIBC_2.38 not found`.
FROM rust:slim-bookworm AS builder

# protobuf-compiler -> tonic-build; cmake/build-essential -> rdkafka cmake-build;
# libcurl/zlib/zstd headers -> librdkafka optional features compiled by cmake.
RUN apt-get update && apt-get install -y --no-install-recommends \
    protobuf-compiler \
    cmake \
    build-essential \
    pkg-config \
    libssl-dev \
    libcurl4-openssl-dev \
    zlib1g-dev \
    libzstd-dev \
    liblz4-dev \
    libsasl2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY services/chat ./services/chat
COPY contracts/proto ./contracts/proto
COPY contracts/lib/rust/authmw ./contracts/lib/rust/authmw

WORKDIR /workspace/services/chat
RUN cargo build --release

# --- Runtime Stage ---
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/local/bin
COPY --from=builder /workspace/services/chat/target/release/chat-service .

ENV CHAT_PORT=8083
ENV CASSANDRA_HOST=cassandra
ENV CASSANDRA_KEYSPACE=discord_chat

EXPOSE 8083
CMD ["./chat-service"]
