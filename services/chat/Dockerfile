# ── Builder ───────────────────────────────────────────────────────────────────
FROM rust:slim AS builder

# cmake + build-essential are required to compile librdkafka from source (cmake-build feature).
RUN apt-get update && apt-get install -y \
    cmake \
    build-essential \
    libssl-dev \
    libcurl4-openssl-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN cargo build --release

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y libssl3 libcurl4 ca-certificates wget && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/local/bin
COPY --from=builder /app/target/release/chat-service .

EXPOSE 8083
CMD ["./chat-service"]
