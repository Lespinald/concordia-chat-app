# --- Builder Stage ---
FROM rust:slim AS builder

WORKDIR /app
COPY . .
RUN cargo build --release

# --- Runtime Stage ---
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/local/bin
COPY --from=builder /app/target/release/chat-service .

ENV CASSANDRA_HOSTS=172.17.0.1:9042
ENV CASSANDRA_KEYSPACE=discord_chat
ENV CHAT_PORT=3000

EXPOSE 3000
CMD ["./chat-service"]