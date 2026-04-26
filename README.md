# Concordia

A Discord-like real-time communication platform built as a polyglot microservices monorepo.

## Architecture

| Service | Language | Port | Role |
|---------|----------|------|------|
| Gateway | Go | 8080 | Auth, reverse-proxy, WebSocket fan-out |
| Auth | Java/Spring Boot | 8081 | Registration, JWT issuance |
| Servers | Java/Spring Boot | 8082 | Server/channel CRUD, CheckPerm gRPC |
| Chat | Rust/Axum | 8083 | Messages, attachments, Kafka producer |
| Voice | Python/FastAPI | 8084 | WebRTC signaling, voice sessions |
| Tips | Python/FastAPI | 8085 | Peer-to-peer tips |
| Presence | Go | 8086 | WebSocket session registry |
| Web App | Next.js | 3000 | Browser client |
| Desktop App | Electron + Next.js | — | Native desktop client |

See [`docs/service-descriptions.md`](docs/service-descriptions.md) for full architecture details.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Docker + docker-compose | >= 24 | https://docs.docker.com/get-docker/ |
| Go | >= 1.22 | `brew install go` |
| Node.js | >= 22 | `brew install node` |
| Java JDK | >= 21 | `brew install openjdk@21` |
| Maven | >= 3.9 | `brew install maven` |
| Rust | >= 1.75 | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Python | >= 3.11 | `brew install python` |
| protoc | >= 3.21 | `brew install protobuf` |

## Quick Start

```bash
# 1. Clone
git clone <repo-url>
cd concordia-chat-app

# 2. Configure environment
cp infra/.env.example infra/.env
# Edit infra/.env to override any defaults (all defaults work for local dev)
# Required: set JWT_SECRET to a 32+ character string before first run

# 3. Start the full stack
docker-compose --env-file infra/.env -f infra/docker-compose.yml up --build

# 4. Open the app
open http://localhost:3000
```

## Running individual service tests

```bash
# Go (Gateway + Presence)
go test ./services/gateway/...
go test ./services/presence/...

# Java (Auth + Servers)
mvn test -pl services/auth
mvn test -pl services/servers

# Rust (Chat)
cd services/chat && cargo test

# Python (Voice + Tips)
cd services/voice && pytest
cd services/tips && pytest

# JavaScript (Web App)
npm test --workspace=apps/web-app
```

## Smoke test

```bash
bash infra/smoke-test.sh
```

Runs the full integration sequence: start stack → register → login → create server → send message → verify.

## Kafka topics

| Topic | Producer | Consumer |
|-------|----------|----------|
| `user-registered` | Auth | Servers |
| `message-created` | Chat | — |
| `mention` | Chat | — |

Monitor a topic locally:
```bash
docker exec kafka kafka-console-consumer.sh \
  --topic user-registered \
  --bootstrap-server localhost:9092 \
  --from-beginning
```

## gRPC

`PermService.CheckPerm` — defined in `contracts/proto/check_perm.proto`

Callers: Gateway, Chat, Voice  
Server: Servers service on port `50051`

Test with:
```bash
grpcurl -plaintext localhost:50051 PermService/CheckPerm \
  -d '{"user_id":"<id>","server_id":"<id>","channel_id":"<id>","action":"READ"}'
```

## Repository layout

```
concordia-chat-app/
├── apps/
│   ├── web-app/          Next.js browser client
│   └── desktop-app/      Electron wrapper
├── services/
│   ├── gateway/          Go
│   ├── auth/             Java/Spring Boot
│   ├── chat/             Rust
│   ├── servers/          Java/Spring Boot
│   ├── voice/            Python/FastAPI
│   ├── presence/         Go
│   └── tips/             Python/FastAPI
├── contracts/
│   ├── proto/            check_perm.proto + generated stubs
│   ├── kafka-schemas/    JSON Schema for Kafka events
│   └── openapi/          gateway.yaml
├── infra/
│   ├── docker-compose.yml
│   └── .env.example
└── docs/
    └── service-descriptions.md
```

## Environment variables

See [`infra/.env.example`](infra/.env.example) for a full annotated list of every variable used across all services.

```bash
cp infra/.env.example infra/.env
# Edit infra/.env — at minimum set JWT_SECRET to a 32+ character secret
docker-compose --env-file infra/.env -f infra/docker-compose.yml up --build
```

`infra/.env` is git-ignored. Never commit real credentials.
