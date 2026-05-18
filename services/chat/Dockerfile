# ── Builder ───────────────────────────────────────────────────────────────────
FROM rust:slim AS builder

# cmake + build-essential are required to compile librdkafka and aws-lc-sys from source.
RUN apt-get update && apt-get install -y \
    cmake \
    build-essential \
    libssl-dev \
    libcurl4-openssl-dev \
    pkg-config \
    nasm \
    perl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache dependency compilation separately from source changes.
# Only Cargo.toml is copied first; cargo generates a fresh Cargo.lock.
# This layer is invalidated only when Cargo.toml changes — not on every src/ edit.
COPY Cargo.toml ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release \
    && rm -rf src target/release/.fingerprint/chat-service*

# Compile actual source — only this step re-runs on src/ changes.
COPY src ./src
RUN touch src/main.rs && cargo build --release

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y libssl3 libcurl4 ca-certificates wget && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/local/bin
COPY --from=builder /app/target/release/chat-service .

EXPOSE 8083
CMD ["./chat-service"]
