# --- Builder Stage ---
FROM rust:slim-bookworm AS builder
# 1. Instalamos dependencias del sistema para Kafka y gRPC
# ¡AGREGAMOS libcurl4-openssl-dev AQUÍ!
RUN apt-get update && apt-get install -y \
    protobuf-compiler \
    cmake \
    g++ \
    pkg-config \
    libssl-dev \
    libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# 2. Compilamos el binario
RUN cargo build --release

# --- Runtime Stage ---
FROM debian:bookworm-slim

# 3. Instalamos librerías necesarias para la ejecución
RUN apt-get update && apt-get install -y \
    libssl3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/local/bin
COPY --from=builder /app/target/release/chat-service .

# 4. Usamos nombres de dominio internos de Docker Compose en lugar de IPs fijas (172.17.x.x)
ENV CASSANDRA_HOSTS=cassandra:9042
ENV KAFKA_BROKERS=kafka:9092
ENV AUTH_GRPC_URL=http://auth-service:50051
ENV CHAT_PORT=3000

EXPOSE 3000
CMD ["./chat-service"]