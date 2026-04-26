# Discord-like App — Service Descriptions

**Architecture:** C&C v0.8 (reduced scope) · **Stack:** 5 languages · **Setup:** docker-compose (local only)

---

## Monorepo Structure

```
discord-app/
├── docker-compose.yml
├── .env.example
├── contracts/
│   ├── proto/                  # gRPC .proto files (shared)
│   │   └── servers.proto       # check-perms RPC
│   └── events/                 # Kafka JSON schemas
│       ├── user-registered.json
│       ├── message-created.json
│       └── mention.json
├── clients/
│   ├── web/                    # Next.js 14 (App Router)
│   └── desktop/                # Electron shell (loads web build)
└── services/
    ├── gateway/                # Go
    ├── auth/                   # Java / Spring Boot
    ├── chat/                   # Rust / Axum
    ├── servers/                # Java / Spring Boot
    ├── voice/                  # Python / FastAPI
    ├── presence/               # Go
    └── tips/                   # Python / FastAPI
```

All shared contracts live in `/contracts` and are the single source of truth. Every service imports or copies from there — never defines its own version.

---

## Infrastructure (docker-compose managed)

These are not implemented by the team — they are off-the-shelf images wired in `docker-compose.yml`.

| Service | Image | Local Port | Used By |
|---|---|---|---|
| Zookeeper | `bitnami/zookeeper` | 2181 | Kafka |
| Kafka | `bitnami/kafka` | 9092 | Gateway, Auth, Chat, Tips |
| PostgreSQL | `postgres:16` | 5432 | Auth DB, Servers DB, Tips DB (separate databases on one instance) |
| Cassandra | `cassandra:4` | 9042 | Chat DB |
| Redis | `redis:7` | 6379 | Presence DB, Voice DB (separate key namespaces) |
| MinIO | `minio/minio` | 9000 / 9001 | Chat Svc (file attachments) |

**Single PostgreSQL instance, three databases:**
```
auth_db     → Auth Svc
servers_db  → Servers Svc
tips_db     → Tips Svc
```

**Single Redis instance, namespaced keys:**
```
presence:*  → Presence Svc
voice:*     → Voice Svc
```

---

## Team Assignments

| # | Person | Components | Language |
|---|---|---|---|
| 1 | Tech Lead | Contracts, monorepo scaffold, docker-compose | — |
| 2 | JS Dev | Web App + Desktop App | JavaScript |
| 3 | Go Dev | API Gateway + Presence Svc | Go |
| 4 | Java Dev A | Auth Svc | Java / Kotlin |
| 5 | Java Dev B | Servers Svc | Java / Kotlin |
| 6 | Rust Dev | Chat Svc | Rust |
| 7 | Python Dev | Voice Svc + Tips Svc | Python |

---

## Component Descriptions

---

### 1. Web App
**Owner:** JS Dev · **Language:** JavaScript · **Framework:** Next.js 14 (App Router)
**Local port:** 3000

The primary browser client. Uses the Next.js App Router with server components for initial page loads and client components for real-time interactivity. Communicates with all backend services exclusively through the API Gateway — never calls services directly.

**Responsibilities:**
- Authentication flows: register, login, logout, email confirmation
- Guild sidebar: list joined guilds, create guild
- Channel list per guild: text channels, voice channels, DMs
- Message view: infinite-scroll history (cursor-based pagination), send message, file upload via presigned MinIO URL
- Real-time updates: maintain a single WebSocket connection to the Gateway; handle incoming `MESSAGE_CREATE`, `PRESENCE_UPDATE`, and `VOICE_STATE_UPDATE` events
- Presence display: show online / idle / DND / offline status for guild members
- Voice: initiate WebRTC peer connection using TURN/STUN config returned by Voice Svc; mute/unmute/leave controls
- Tips opt-in: UI for managing email subscription preferences

**Key environment variables:**
```
NEXT_PUBLIC_GATEWAY_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

**Development notes:**
- Use MSW (Mock Service Worker) to stub API responses before the Gateway is live
- All API calls go to `NEXT_PUBLIC_GATEWAY_URL` — no service URLs in the client
- WebSocket connection opens on login and closes on logout

---

### 2. Desktop App
**Owner:** JS Dev · **Language:** JavaScript · **Framework:** Electron 30
**Approach:** Electron shell that loads the compiled Next.js web build — no separate UI codebase

The desktop app is not a separate application. Electron loads the Next.js build (`out/`) from disk (static export) or from a local Next.js server running inside the same Electron process. This means the JS Dev maintains one codebase and gets both targets from it.

**Build flow:**
```
next build → next export (static HTML/JS/CSS into out/)
             ↓
         Electron loads out/index.html via BrowserWindow
```

**Responsibilities:**
- Electron main process: create `BrowserWindow`, load the Next.js static export
- Native OS notifications via Electron's `Notification` API (triggered by WebSocket events received in the renderer)
- System tray icon with unread badge count
- Auto-updater (`electron-updater`) for distributing new builds
- Global push-to-talk keyboard shortcut via `globalShortcut`
- `discord://` deep link handling for guild invite URLs
- Persist window state (size, position) across restarts via `electron-store`

**Monorepo note:**
```
clients/
├── web/          # Next.js source (next.config.js sets output: 'export')
└── desktop/
    ├── main.js   # Electron main process
    ├── package.json
    └── (loads ../web/out/ at runtime)
```

The desktop `package.json` has a `prebuild` script that runs `next build && next export` in `../web` first.

---

### 3. API Gateway
**Owner:** Go Dev · **Language:** Go · **Framework:** chi (router) + gorilla/websocket
**Local port:** 8080

The single entry point for all client traffic. Every REST call and WebSocket connection from Web App and Desktop App goes through the Gateway. Downstream services are never exposed directly.

**Responsibilities:**
- Route REST requests to the correct upstream service based on path prefix
- Upgrade HTTP connections to WebSocket; maintain the connection registry (map of `userID → connection`) in memory, backed by Presence Svc for cross-instance routing
- Validate JWT tokens on every request: parse and verify signature, attach `userID` to the forwarded request as a header (`X-User-ID`)
- Rate limiting: 60 req/min per user (REST), 10 concurrent WS connections per user; use an in-memory token bucket backed by Redis
- Call Servers Svc via gRPC (`check-perms`) before forwarding any Chat or Voice request to verify the user has access to the target channel
- Fan-out: consume Kafka `message-created` events and push them over WebSocket to all connected members of the target channel; use Presence DB (Redis) to find which members are online
- Health check endpoint: `GET /health`

**Route table:**
```
POST   /auth/register          → auth:8081
POST   /auth/login             → auth:8081
POST   /auth/logout            → auth:8081
GET    /users/:id/friends      → auth:8081
*      /guilds/*               → servers:8082
*      /channels/*             → chat:8083  (after check-perms)
*      /sessions/*             → voice:8084 (after check-perms)
PUT    /presence/:id           → presence:8085
GET    /presence               → presence:8085
*      /subscriptions/*        → tips:8086
WS     /ws                     → internal fan-out handler
```

**gRPC client:**
- `servers.CheckPerm(userID, channelID, guildID) → { allowed, reason }` — called before routing to chat or voice

**Kafka consumer:**
- Topic: `message-created` — fan-out to WebSocket connections

**Key environment variables:**
```
JWT_SECRET=...
KAFKA_BROKERS=kafka:9092
REDIS_ADDR=redis:6379
AUTH_ADDR=auth:8081
SERVERS_ADDR=servers:8082
CHAT_ADDR=chat:8083
VOICE_ADDR=voice:8084
PRESENCE_ADDR=presence:8085
TIPS_ADDR=tips:8086
```

---

### 4. Auth Svc
**Owner:** Java Dev A · **Language:** Java 21 · **Framework:** Spring Boot 3 + Spring Security
**Local port:** 8081

Owns all user identity: registration, login, session management, and friend relationships. Issues and signs JWTs consumed by the Gateway. The only service that writes to `auth_db`.

**Responsibilities:**
- `POST /auth/register` — validate input, hash password (bcrypt, cost 12), persist user, publish `user-registered` event to Kafka, return `201`
- `POST /auth/login` — verify credentials, issue access JWT (15 min TTL) + refresh token (30 days), persist refresh token in `sessions` table
- `POST /auth/logout` — invalidate refresh token
- `POST /auth/refresh` — exchange valid refresh token for new access JWT
- `POST /auth/confirm-email` — verify time-limited confirmation token (store in `email_confirmations` table)
- `GET /users/:id` — public profile (username, avatar)
- `GET /users/:id/friends` — list accepted friend relationships
- `POST /users/:id/friends` — send friend request
- `PUT /users/:id/friends/:friendId` — accept or reject friend request

**Database:** `auth_db` (PostgreSQL)
```sql
users               (id uuid PK, email, username, password_hash, confirmed bool, created_at)
sessions            (id uuid PK, user_id FK, refresh_token, expires_at)
email_confirmations (token, user_id FK, expires_at)
friends             (user_id FK, friend_id FK, status ENUM('pending','accepted','rejected'), created_at)
```

**Kafka producer:**
- Topic: `user-registered` · Payload: `{ userId, email, username, createdAt }`
- Publish after successful registration (after DB commit, before responding to client)

**Key environment variables:**
```
DB_URL=jdbc:postgresql://postgres:5432/auth_db
DB_USER=...
DB_PASS=...
JWT_SECRET=...
JWT_TTL_MINUTES=15
REFRESH_TTL_DAYS=30
KAFKA_BROKERS=kafka:9092
```

---

### 5. Servers Svc
**Owner:** Java Dev B · **Language:** Java 21 · **Framework:** Spring Boot 3 + Spring Data JPA
**Local port:** 8082

Manages guilds, channels within guilds, member rosters, and the role/permission system. Also exposes the `check-perms` gRPC endpoint consumed by the Gateway.

**Responsibilities:**
- `POST /guilds` — create guild, make requester owner, create default `#general` text channel
- `GET /guilds/:id` — guild details, channel list, member count
- `PUT /guilds/:id` — update name, icon, description (owner only)
- `DELETE /guilds/:id` — delete guild (owner only)
- `POST /guilds/:id/channels` — create text or voice channel
- `DELETE /guilds/:id/channels/:channelId` — delete channel
- `GET /guilds/:id/members` — paginated member list with roles
- `POST /guilds/:id/members` — join guild (via invite code)
- `DELETE /guilds/:id/members/:userId` — kick member (requires KICK_MEMBERS permission)
- `GET /guilds/:id/roles` — list roles
- `POST /guilds/:id/roles` — create role
- `PUT /guilds/:id/roles/:roleId` — update role name and permission bitmask
- `PUT /guilds/:id/channels/:channelId/permissions` — set permission overwrites per role or member
- gRPC server: `CheckPerm(userID, channelID, guildID) → { allowed, reason }` — evaluate the user's roles against the channel's permission overwrites

**Database:** `servers_db` (PostgreSQL)
```sql
guilds               (id uuid PK, name, owner_id, icon_url, created_at)
channels             (id uuid PK, guild_id FK, name, type ENUM('text','voice'), position int)
roles                (id uuid PK, guild_id FK, name, permissions bigint, position int, color)
members              (guild_id FK, user_id, joined_at, PK(guild_id, user_id))
role_assignments     (guild_id FK, user_id, role_id FK, PK(guild_id, user_id, role_id))
permission_overwrites(channel_id FK, target_id, target_type ENUM('role','member'), allow_bits bigint, deny_bits bigint)
invite_codes         (code PK, guild_id FK, created_by, max_uses, uses, expires_at)
```

**gRPC server:** Implement `contracts/proto/servers.proto`
```protobuf
service ServersService {
  rpc CheckPerm(CheckPermRequest) returns (CheckPermResponse);
}
message CheckPermRequest  { string user_id = 1; string channel_id = 2; string guild_id = 3; }
message CheckPermResponse { bool allowed = 1; string reason = 2; }
```

**Key environment variables:**
```
DB_URL=jdbc:postgresql://postgres:5432/servers_db
DB_USER=...
DB_PASS=...
GRPC_PORT=9090
```

---

### 6. Chat Svc
**Owner:** Rust Dev · **Language:** Rust · **Framework:** Axum + Tokio
**Local port:** 8083

The highest-throughput service. Persists all messages to Cassandra, handles file attachment uploads via MinIO presigned URLs, and publishes events to Kafka for downstream fan-out.

**Responsibilities:**
- `POST /channels/:id/messages` — validate body, persist message to Cassandra, publish `message-created` (and `mention` if `@user` detected) to Kafka, return message object
- `GET /channels/:id/messages?before=<cursor>&limit=50` — cursor-paginated message history, newest-first
- `GET /channels/:id` — channel metadata (name, guild, type)
- `POST /channels/:id/attachments/presign` — generate a presigned MinIO PUT URL for the client to upload a file directly; return the URL + the final object key to reference in the message body
- `POST /dms` — create or retrieve a DM channel between two users (stored as a special guild-less channel)
- `DELETE /channels/:id/messages/:messageId` — soft-delete (set `deleted=true`), author or MANAGE_MESSAGES permission required

**Database:** `chat_db` (Cassandra)
```
messages (
  channel_id   uuid,
  bucket       int,        -- floor(created_at_unix / 86400) for time-range partitioning
  message_id   timeuuid,
  author_id    uuid,
  content      text,
  attachments  list<text>, -- MinIO object keys
  deleted      boolean,
  PRIMARY KEY ((channel_id, bucket), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);

channels (
  channel_id   uuid PRIMARY KEY,
  guild_id     uuid,
  name         text,
  type         text        -- 'text' | 'dm'
);
```

**Object Store (MinIO):**
- Bucket: `attachments`
- Chat Svc generates presigned PUT URLs (5 min TTL) via the MinIO SDK
- The client uploads directly to MinIO; Chat Svc stores the resulting object key in the message

**Kafka producer:**
- Topic: `message-created` · Payload: `{ messageId, channelId, guildId, authorId, content, attachments, createdAt }`
- Topic: `mention` · Payload: `{ messageId, channelId, guildId, mentionedUserId, authorId, createdAt }` — one event per `@mention` found in content

**Key environment variables:**
```
CASSANDRA_HOSTS=cassandra:9042
CASSANDRA_KEYSPACE=chat
KAFKA_BROKERS=kafka:9092
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=attachments
```

---

### 7. Voice Svc
**Owner:** Python Dev · **Language:** Python 3.12 · **Framework:** FastAPI + aiortc
**Local port:** 8084

Manages voice channel sessions and WebRTC signaling. Tracks who is in which voice channel and relays SDP and ICE candidates between peers. A full SFU (Selective Forwarding Unit) is out of scope — this sprint delivers peer-to-peer WebRTC with server-side signaling only.

**Responsibilities:**
- `POST /sessions` — join a voice channel: create session record in Redis, return STUN/TURN server config for the client to initiate WebRTC
- `DELETE /sessions/:id` — leave voice channel: remove session from Redis, notify remaining members via Kafka (future)
- `GET /channels/:id/members` — list users currently in a voice channel (read from Redis set)
- WebSocket signaling endpoint `WS /signal/:channelId` — relay SDP offer/answer and ICE candidates between peers in the same channel
- Heartbeat: clients send `ping` every 15s; sessions with no heartbeat for 30s are expired (Redis TTL)

**Database:** `voice:*` keys in Redis
```
voice:session:{sessionId}     HASH  userId, channelId, guildId, joinedAt
voice:channel:{channelId}     SET   sessionIds currently in channel
```
Use Redis `EXPIRE` on session hashes (30s TTL, refreshed by heartbeat).

**WebRTC signaling flow (peer-to-peer):**
```
Client A connects WS /signal/{channelId}
Client B connects WS /signal/{channelId}
Voice Svc relays: A's SDP offer → B
                  B's SDP answer → A
                  A/B ICE candidates ↔ relayed to all peers in channel
```

**Key environment variables:**
```
REDIS_ADDR=redis://redis:6379
STUN_SERVER=stun:stun.l.google.com:19302
```

---

### 8. Presence Svc
**Owner:** Go Dev · **Language:** Go · **Framework:** chi
**Local port:** 8085

Tracks and serves user presence status (Online, Idle, DND, Invisible) and stores which Gateway instance each user's WebSocket is connected to. This second responsibility makes Presence Svc the **WebSocket session registry** — the Gateway reads it to know where to fan out events.

**Responsibilities:**
- `PUT /presence/:userId` — set status (`online` / `idle` / `dnd` / `invisible`) and record the gateway instance ID; called by the Gateway on WebSocket connect and on client status change
- `GET /presence/:userId` — get current status for one user
- `POST /presence/batch` — bulk status lookup for a list of `userIds` (used when loading a guild member list)
- `DELETE /presence/:userId` — mark user offline; called by Gateway on WebSocket disconnect
- Heartbeat: Gateway pings Presence Svc every 20s per connected user; Presence Svc refreshes the Redis TTL; users with expired keys are implicitly offline

**Database:** `presence:*` keys in Redis
```
presence:{userId}   HASH  status, gatewayInstanceId, lastSeen
                    TTL: 60s (refreshed by Gateway heartbeat)
```

**How the Gateway uses Presence Svc for fan-out:**
1. Kafka delivers `message-created` for channel `C`
2. Gateway asks Servers Svc for the member list of `C`'s guild
3. Gateway calls `POST /presence/batch` with those userIDs
4. For each online user whose `gatewayInstanceId` matches this instance, push over their WebSocket
5. For users on other instances — publish a targeted Redis pub/sub message to that instance (future: multi-instance)

**Key environment variables:**
```
REDIS_ADDR=redis:6379
INSTANCE_ID=gateway-1   # injected by docker-compose
```

---

### 9. Tips Svc
**Owner:** Python Dev · **Language:** Python 3.12 · **Framework:** FastAPI + SQLAlchemy
**Local port:** 8086

Manages opt-in email subscriptions and tip notifications. Subscribes new users automatically by consuming the `user-registered` Kafka event, creating a default subscription record. Provides endpoints for users to manage their preferences.

**Responsibilities:**
- Kafka consumer: consume `user-registered` events → create a default subscription record for the new user (opted-in by default, users can opt out)
- `GET /subscriptions/:userId` — get subscription preferences
- `POST /subscriptions` — opt user in to a subscription type
- `DELETE /subscriptions/:userId` — opt user out of all subscriptions
- `PUT /subscriptions/:userId` — update individual subscription preferences (e.g. weekly digest, product updates)
- Send a welcome email on first subscription creation (stub with a console log locally; wire to an SMTP provider or SES later)

**Database:** `tips_db` (PostgreSQL)
```sql
subscriptions (
  user_id      uuid PK,
  weekly_digest    bool DEFAULT true,
  product_updates  bool DEFAULT true,
  opted_out_at     timestamp,
  created_at       timestamp
)
email_log (
  id         uuid PK,
  user_id    uuid FK,
  type       text,
  sent_at    timestamp
)
```

**Kafka consumer:**
- Topic: `user-registered` · Consumer group: `tips-svc-cg`
- On receive: `INSERT INTO subscriptions (user_id, ...) ON CONFLICT DO NOTHING`

**Key environment variables:**
```
DB_URL=postgresql://...@postgres:5432/tips_db
KAFKA_BROKERS=kafka:9092
KAFKA_GROUP_ID=tips-svc-cg
SMTP_HOST=...   # stub locally
```

---

## Shared Contracts

These files live in `/contracts` and must be committed before any service starts Phase 2.

### gRPC — `contracts/proto/servers.proto`
```protobuf
syntax = "proto3";
package servers;

service ServersService {
  rpc CheckPerm (CheckPermRequest) returns (CheckPermResponse);
}

message CheckPermRequest {
  string user_id    = 1;
  string channel_id = 2;
  string guild_id   = 3;
}

message CheckPermResponse {
  bool   allowed = 1;
  string reason  = 2;
}
```

### Kafka Event Schemas — `contracts/events/`

**`user-registered.json`**
```json
{
  "userId":    "uuid",
  "email":     "string",
  "username":  "string",
  "createdAt": "ISO 8601"
}
```

**`message-created.json`**
```json
{
  "messageId":   "uuid",
  "channelId":   "uuid",
  "guildId":     "uuid | null",
  "authorId":    "uuid",
  "content":     "string",
  "attachments": ["string"],
  "createdAt":   "ISO 8601"
}
```

**`mention.json`**
```json
{
  "messageId":       "uuid",
  "channelId":       "uuid",
  "guildId":         "uuid | null",
  "mentionedUserId": "uuid",
  "authorId":        "uuid",
  "createdAt":       "ISO 8601"
}
```

---

## docker-compose.yml (skeleton)

```yaml
version: "3.9"

services:

  # ── Infrastructure ─────────────────────────────────────────

  zookeeper:
    image: bitnami/zookeeper:3.9
    environment:
      ALLOW_ANONYMOUS_LOGIN: "yes"
    ports: ["2181:2181"]

  kafka:
    image: bitnami/kafka:3.6
    depends_on: [zookeeper]
    ports: ["9092:9092"]
    environment:
      KAFKA_CFG_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_CFG_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE: "true"
    healthcheck:
      test: ["CMD", "kafka-topics.sh", "--bootstrap-server", "localhost:9092", "--list"]
      interval: 10s
      retries: 5

  postgres:
    image: postgres:16
    ports: ["5432:5432"]
    environment:
      POSTGRES_USER: discord
      POSTGRES_PASSWORD: discord
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./infra/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U discord"]
      interval: 5s
      retries: 5

  cassandra:
    image: cassandra:4
    ports: ["9042:9042"]
    volumes:
      - cassandra_data:/var/lib/cassandra
    healthcheck:
      test: ["CMD", "cqlsh", "-e", "describe keyspaces"]
      interval: 15s
      retries: 10

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 5

  minio:
    image: minio/minio
    ports: ["9000:9000", "9001:9001"]
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 10s
      retries: 5

  # ── Services ───────────────────────────────────────────────

  auth:
    build: ./services/auth
    ports: ["8081:8081"]
    depends_on:
      postgres: { condition: service_healthy }
      kafka:    { condition: service_healthy }
    env_file: ./services/auth/.env

  servers:
    build: ./services/servers
    ports: ["8082:8082", "9090:9090"]   # 9090 = gRPC
    depends_on:
      postgres: { condition: service_healthy }
    env_file: ./services/servers/.env

  chat:
    build: ./services/chat
    ports: ["8083:8083"]
    depends_on:
      cassandra: { condition: service_healthy }
      kafka:     { condition: service_healthy }
      minio:     { condition: service_healthy }
    env_file: ./services/chat/.env

  voice:
    build: ./services/voice
    ports: ["8084:8084"]
    depends_on:
      redis: { condition: service_healthy }
    env_file: ./services/voice/.env

  presence:
    build: ./services/presence
    ports: ["8085:8085"]
    depends_on:
      redis: { condition: service_healthy }
    env_file: ./services/presence/.env
    environment:
      INSTANCE_ID: gateway-1

  tips:
    build: ./services/tips
    ports: ["8086:8086"]
    depends_on:
      postgres: { condition: service_healthy }
      kafka:    { condition: service_healthy }
    env_file: ./services/tips/.env

  gateway:
    build: ./services/gateway
    ports: ["8080:8080"]
    depends_on:
      auth:     { condition: service_started }
      servers:  { condition: service_started }
      chat:     { condition: service_started }
      voice:    { condition: service_started }
      presence: { condition: service_started }
      tips:     { condition: service_started }
      kafka:    { condition: service_healthy }
      redis:    { condition: service_healthy }
    env_file: ./services/gateway/.env

  web:
    build: ./clients/web
    ports: ["3000:3000"]
    depends_on: [gateway]
    environment:
      NEXT_PUBLIC_GATEWAY_URL: http://localhost:8080
      NEXT_PUBLIC_WS_URL: ws://localhost:8080

volumes:
  postgres_data:
  cassandra_data:
  redis_data:
  minio_data:
```

### `infra/postgres/init.sql`
```sql
CREATE DATABASE auth_db;
CREATE DATABASE servers_db;
CREATE DATABASE tips_db;
```

---

## Stubbing Strategy (Phase 2)

Every team can work independently by stubbing their dependencies:

| Dependency | How to stub locally |
|---|---|
| Kafka (consumer) | Run a local producer script in `infra/kafka/seed/` that publishes fake events to the topic |
| Kafka (producer) | Just publish to the real Kafka container — it accepts events even with no consumers |
| gRPC `check-perms` (Gateway, Chat) | Implement a tiny Go/Rust gRPC server that always returns `{ allowed: true }` |
| gRPC `check-perms` server (Servers Svc) | Implement the real thing — no upstream dependencies needed |
| REST API (Web/Desktop) | Use MSW (Mock Service Worker) with fixtures matching the OpenAPI spec |
| MinIO presign (Chat) | MinIO runs locally in docker-compose — no stub needed |
| SMTP / email (Tips) | `print()` / `console.log()` to stdout; wire real SMTP after MVP |
| STUN/TURN (Voice) | Use Google's public STUN `stun:stun.l.google.com:19302` — no infra needed |
