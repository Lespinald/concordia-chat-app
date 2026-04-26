# Discord-Like App — Implementation Tasks
**Project:** CON | **Deadline:** May 3, 2026 | **Team:** 7 people
**Stack:** Go (Gateway, Presence) · Java/Kotlin (Auth, Servers) · Rust (Chat) · Python (Voice, Tips) · JavaScript (Web App, Desktop App)

---

## Legend
- **DoD:** Definition of Done — concrete, verifiable criteria
- **Deps:** Task IDs that must be complete first
- **Est:** Effort estimate in hours

---

## Epic 1 — Shared Contracts & Monorepo

### T-01 · Bootstrap monorepo structure
**Assignee:** Tech Lead | **Deadline:** Apr 23 | **Est:** 3h | **Deps:** —

**Description:** Initialize the monorepo with top-level workspace config and per-service scaffolding so every team member can `git clone` and run a single bootstrap command.

**Definition of Done:**
- Root `package.json` (JS workspaces), `go.work`, and root `pom.xml`/`build.gradle` stubs exist and validate without errors
- Directory tree matches:
  ```
  /apps/web-app/
  /apps/desktop-app/
  /services/gateway/
  /services/auth/
  /services/chat/
  /services/servers/
  /services/voice/
  /services/presence/
  /services/tips/
  /contracts/proto/
  /contracts/kafka-schemas/
  /contracts/openapi/
  /infra/docker-compose.yml
  ```
- `README.md` at root documents how to run `docker-compose up` for the full stack
- `git log` shows initial commit with this structure on `main`
- Running `ls services/` from the repo root lists all 7 service directories

---

### T-02 · Define gRPC proto: CheckPerm
**Assignee:** Tech Lead | **Deadline:** Apr 24 | **Est:** 4h | **Deps:** T-01

**Description:** Write the canonical `check_perm.proto` file used by Gateway, Chat, and Voice to query the Servers Svc for user permissions in a server/channel.

**Definition of Done:**
- File exists at `contracts/proto/check_perm.proto`
- Proto defines service `PermService` with RPC `CheckPerm(CheckPermRequest) returns (CheckPermResponse)`
- `CheckPermRequest` contains: `user_id` (string), `server_id` (string), `channel_id` (string), `action` (enum: READ, WRITE, VOICE_JOIN, MANAGE)
- `CheckPermResponse` contains: `allowed` (bool), `reason` (string)
- Running `protoc --go_out=. contracts/proto/check_perm.proto` completes without errors
- Generated stubs committed to `contracts/proto/gen/go/` and `contracts/proto/gen/java/`

---

### T-03 · Define Kafka schemas (Avro/JSON Schema)
**Assignee:** Tech Lead | **Deadline:** Apr 24 | **Est:** 3h | **Deps:** T-01

**Description:** Define the message schemas for the three Kafka topics the system uses: `user-registered`, `message-created`, `mention`.

**Definition of Done:**
- Files exist at:
  - `contracts/kafka-schemas/user-registered.json`
  - `contracts/kafka-schemas/message-created.json`
  - `contracts/kafka-schemas/mention.json`
- Each schema file is valid JSON Schema (Draft-07) and documents all required fields with types and descriptions
- `user-registered` schema includes: `user_id`, `username`, `email`, `created_at`
- `message-created` schema includes: `message_id`, `channel_id`, `server_id`, `author_id`, `content`, `attachments[]`, `created_at`
- `mention` schema includes: `mention_id`, `message_id`, `mentioned_user_id`, `channel_id`, `server_id`, `created_at`
- A `contracts/kafka-schemas/README.md` documents which service produces and which consumes each topic

---

### T-04 · Define OpenAPI spec for Gateway REST endpoints
**Assignee:** Tech Lead | **Deadline:** Apr 25 | **Est:** 5h | **Deps:** T-01

**Description:** Write the OpenAPI 3.1 spec covering all REST routes exposed by the API Gateway (auth, servers, channels, messages, attachments, voice, tips).

**Definition of Done:**
- File exists at `contracts/openapi/gateway.yaml`
- Spec is valid — `npx @redocly/cli lint contracts/openapi/gateway.yaml` exits with code 0
- Spec defines at minimum these route groups with request/response schemas:
  - `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `DELETE /auth/logout`
  - `GET/POST /servers`, `GET/PUT/DELETE /servers/{id}`
  - `GET/POST /servers/{id}/channels`, `GET/PUT/DELETE /servers/{id}/channels/{cid}`
  - `GET/POST /channels/{id}/messages`, `DELETE /channels/{id}/messages/{mid}`
  - `POST /channels/{id}/attachments`
  - `POST /voice/{channelId}/join`, `POST /voice/{channelId}/leave`
  - `GET/POST /tips`, `GET /tips/{id}`
- All protected routes document `Authorization: Bearer <token>` header
- At least one example request/response per route group

---

### T-05 · Shared auth middleware library
**Assignee:** Tech Lead | **Deadline:** Apr 25 | **Est:** 4h | **Deps:** T-02, T-04

**Description:** Create a JWT validation library/module that all services can import to verify Bearer tokens without re-implementing validation logic.

**Definition of Done:**
- For Go services: package `contracts/lib/go/authmw` exports `ValidateJWT(token string) (*Claims, error)` 
- For Java services: module `contracts/lib/java/authmw` exports `JwtValidator.validate(String token): Claims`
- For Python services: module `contracts/lib/python/authmw` exports `validate_jwt(token: str) -> dict`
- For Rust services: crate `contracts/lib/rust/authmw` exports `fn validate_jwt(token: &str) -> Result<Claims, AuthError>`
- Each library reads the JWT secret from env var `JWT_SECRET`
- Unit tests in each library cover: valid token → returns claims, expired token → returns error, tampered token → returns error
- All tests pass: `go test ./...`, `mvn test`, `pytest`, `cargo test`

---

## Epic 2 — Infrastructure & docker-compose

### T-06 · docker-compose: Kafka + Zookeeper
**Assignee:** Tech Lead | **Deadline:** Apr 24 | **Est:** 2h | **Deps:** T-01

**Description:** Add Kafka and Zookeeper services to docker-compose so the event broker is available for local development.

**Definition of Done:**
- `infra/docker-compose.yml` contains `zookeeper` and `kafka` service definitions
- Kafka is reachable at `localhost:9092` after `docker-compose up kafka`
- Running `docker exec kafka kafka-topics.sh --list --bootstrap-server localhost:9092` succeeds (no error, topics can be empty)
- Topics `user-registered`, `message-created`, `mention` are auto-created on startup (via `KAFKA_CREATE_TOPICS` env var or init script)
- Kafka and Zookeeper containers restart automatically on failure (`restart: unless-stopped`)

---

### T-07 · docker-compose: Databases (PostgreSQL, Cassandra, Redis, MinIO)
**Assignee:** Tech Lead | **Deadline:** Apr 24 | **Est:** 3h | **Deps:** T-01

**Description:** Add all four database/storage services to docker-compose with persistent volumes and initial credentials.

**Definition of Done:**
- `infra/docker-compose.yml` contains: `postgres`, `cassandra`, `redis`, `minio` services
- PostgreSQL reachable at `localhost:5432`, default DB `discord_auth` created on startup
- Cassandra reachable at `localhost:9042`, keyspace `discord_chat` created on startup via init CQL script
- Redis reachable at `localhost:6379`, no auth (dev mode)
- MinIO reachable at `localhost:9000` (API) and `localhost:9001` (console), bucket `attachments` created on startup
- Each service uses a named Docker volume so data persists across `docker-compose down` / `docker-compose up`
- `docker-compose ps` shows all 4 services as `Up` after `docker-compose up -d`

---

### T-08 · docker-compose: All application services
**Assignee:** Tech Lead | **Deadline:** Apr 26 | **Est:** 4h | **Deps:** T-06, T-07

**Description:** Add all 7 application services (Gateway, Auth, Chat, Servers, Voice, Presence, Tips) to docker-compose, wired to their respective databases and to Kafka.

**Definition of Done:**
- Each of the 7 services has a corresponding entry in `docker-compose.yml` with:
  - `build: context` pointing to its service directory
  - `depends_on` listing its required databases and Kafka
  - Environment variables for DB connection, Kafka bootstrap, JWT secret
  - Health check defined (e.g., `GET /health` returns 200)
- `docker-compose up --build` completes without error and all 9 services (infra + 7 app) show `Up` in `docker-compose ps` within 2 minutes
- Each app service logs at least one "service started" message to stdout

---

### T-09 · docker-compose: Web App (Next.js dev server)
**Assignee:** Tech Lead | **Deadline:** Apr 26 | **Est:** 2h | **Deps:** T-08

**Description:** Add the Web App to docker-compose so frontend devs can run the full stack with one command.

**Definition of Done:**
- `docker-compose.yml` contains `web-app` service using Node.js image
- Web App is accessible at `http://localhost:3000` after `docker-compose up web-app`
- The Next.js dev server starts without errors and hot-reloads are reflected within the container
- `NEXT_PUBLIC_API_URL` env var is set to `http://gateway:8080` inside the container

---

### T-10 · Shared environment variables documentation
**Assignee:** Tech Lead | **Deadline:** Apr 26 | **Est:** 2h | **Deps:** T-08, T-09

**Description:** Create a `.env.example` file at the repo root documenting every environment variable used across all services.

**Definition of Done:**
- File `infra/.env.example` exists and contains all env vars with placeholder values and inline comments
- Every env var used in `docker-compose.yml` is listed in `.env.example`
- Variables include at minimum: `JWT_SECRET`, `POSTGRES_*`, `CASSANDRA_*`, `REDIS_*`, `MINIO_*`, `KAFKA_BOOTSTRAP_SERVERS`, `GATEWAY_PORT`
- A section in `README.md` explains how to `cp infra/.env.example infra/.env` and fill in values before running

---

## Epic 3 — API Gateway (Go)

### T-11 · Gateway: Project scaffold
**Assignee:** Go Dev | **Deadline:** Apr 26 | **Est:** 3h | **Deps:** T-01, T-04

**Description:** Initialize the Go service for the API Gateway with routing framework, config loading, and health check endpoint.

**Definition of Done:**
- `services/gateway/` contains a working Go module (`go.mod`) with a `main.go` entry point
- Service reads port from env var `GATEWAY_PORT` (default 8080)
- `GET /health` returns `{"status":"ok"}` with HTTP 200
- `go build ./...` succeeds with no errors
- Dockerfile exists at `services/gateway/Dockerfile` and builds successfully

---

### T-12 · Gateway: JWT auth middleware
**Assignee:** Go Dev | **Deadline:** Apr 27 | **Est:** 3h | **Deps:** T-05, T-11

**Description:** Plug the shared JWT validation library into the Gateway so all protected routes reject unauthenticated requests.

**Definition of Done:**
- All routes except `POST /auth/register` and `POST /auth/login` require `Authorization: Bearer <token>` header
- `curl -X GET http://localhost:8080/servers` without a token returns HTTP 401 with body `{"error":"unauthorized"}`
- `curl -X GET http://localhost:8080/servers -H "Authorization: Bearer <valid_token>"` returns HTTP 200 (or 502 if upstream is down, not 401)
- Expired or tampered tokens return HTTP 401

---

### T-13 · Gateway: Reverse proxy routes (HTTP)
**Assignee:** Go Dev | **Deadline:** Apr 27 | **Est:** 4h | **Deps:** T-11, T-12

**Description:** Implement HTTP reverse proxy routing from Gateway to all downstream services, following the OpenAPI spec.

**Definition of Done:**
- All REST route groups from T-04 are proxied to the correct upstream service:
  - `/auth/*` → Auth Svc (`http://auth:8081`)
  - `/servers/*`, `/channels/*` → Servers Svc (`http://servers:8082`)
  - `/channels/*/messages*`, `/channels/*/attachments*` → Chat Svc (`http://chat:8083`)
  - `/voice/*` → Voice Svc (`http://voice:8084`)
  - `/tips/*` → Tips Svc (`http://tips:8085`)
- Unknown routes return HTTP 404 with `{"error":"not found"}`
- Upstream errors (5xx) are proxied back to the client unchanged
- Route table is validated by at least one integration test per route group using a mock upstream

---

### T-14 · Gateway: WebSocket upgrade + fan-out to Presence
**Assignee:** Go Dev | **Deadline:** Apr 28 | **Est:** 5h | **Deps:** T-11, T-12

**Description:** Handle WebSocket upgrades at `GET /ws` and register the session with the Presence Svc.

**Definition of Done:**
- `GET /ws` with a valid JWT upgrades the connection to WebSocket
- On connection open, Gateway calls `POST http://presence:8086/sessions` with `{user_id, connection_id}` and receives HTTP 200
- On connection close (graceful or error), Gateway calls `DELETE http://presence:8086/sessions/{connection_id}`
- The Gateway forwards inbound WS messages (JSON) to the appropriate downstream HTTP endpoint
- `wscat -c ws://localhost:8080/ws -H "Authorization: Bearer <token>"` connects successfully and echoes a `{"type":"connected"}` message
- Load test with 50 simultaneous WebSocket connections completes without crashes or goroutine leaks (verified via `pprof`)

---

### T-15 · Gateway: Rate limiting
**Assignee:** Go Dev | **Deadline:** Apr 29 | **Est:** 3h | **Deps:** T-12, T-13

**Description:** Add per-user rate limiting on REST endpoints to prevent abuse.

**Definition of Done:**
- Rate limit is 100 requests/minute per `user_id` (extracted from JWT)
- Exceeding the limit returns HTTP 429 with `Retry-After` header
- Rate limit counters are stored in Redis (env var `REDIS_ADDR`)
- After 1 minute, counter resets and requests are accepted again
- Unit test simulates 101 requests in under a minute and asserts the 101st returns 429

---

### T-16 · Gateway: CORS configuration
**Assignee:** Go Dev | **Deadline:** Apr 29 | **Est:** 1h | **Deps:** T-11

**Description:** Configure CORS so the Web App (localhost:3000) can call the Gateway without browser errors.

**Definition of Done:**
- Preflight `OPTIONS` requests return HTTP 200 with correct CORS headers
- `Access-Control-Allow-Origin` is configurable via env var `ALLOWED_ORIGINS` (default: `http://localhost:3000`)
- `Access-Control-Allow-Methods` includes: GET, POST, PUT, DELETE, OPTIONS
- `Access-Control-Allow-Headers` includes: Content-Type, Authorization
- Browser test: opening the Web App at localhost:3000 and making any API call does not produce a CORS error in the browser console

---

### T-17 · Gateway: Request/response logging middleware
**Assignee:** Go Dev | **Deadline:** Apr 29 | **Est:** 2h | **Deps:** T-11

**Description:** Add structured logging middleware that logs every incoming request and outgoing response.

**Definition of Done:**
- Every HTTP request produces one structured log line in JSON format with: `timestamp`, `method`, `path`, `status_code`, `latency_ms`, `user_id` (if authenticated)
- Logs are written to stdout
- Health check endpoint (`GET /health`) is excluded from logs to reduce noise
- Running `docker-compose logs gateway` shows log lines for each request made to the gateway

---

### T-18 · Gateway: Unit + integration tests
**Assignee:** Go Dev | **Deadline:** May 1 | **Est:** 4h | **Deps:** T-13, T-14, T-15

**Description:** Write tests covering the main Gateway behaviours.

**Definition of Done:**
- `go test ./...` in `services/gateway/` passes with zero failures
- Test coverage ≥ 70% (verified by `go test -cover`)
- Tests cover: JWT validation (valid, expired, missing), rate limiting (under/over limit), WebSocket upgrade, proxy routing (correct upstream selected per path)
- Integration test spins up a mock upstream and verifies the full request cycle: client → gateway → upstream → client

---

## Epic 4 — Auth Service (Java/Kotlin)

### T-19 · Auth: Project scaffold
**Assignee:** Java Dev A | **Deadline:** Apr 26 | **Est:** 3h | **Deps:** T-01

**Description:** Initialize the Auth service as a Spring Boot application with database connectivity and health endpoint.

**Definition of Done:**
- `services/auth/` contains a working Maven/Gradle project with Spring Boot entry point
- Service reads `POSTGRES_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD` from environment
- Flyway (or Liquibase) migrations run on startup and create `users` table
- `GET /health` returns `{"status":"ok"}` with HTTP 200
- `./mvnw package -DskipTests` (or `./gradlew build -x test`) completes without errors
- Dockerfile exists at `services/auth/Dockerfile` and produces a runnable image

---

### T-20 · Auth: User registration endpoint
**Assignee:** Java Dev A | **Deadline:** Apr 27 | **Est:** 4h | **Deps:** T-19

**Description:** Implement `POST /auth/register` — create a new user, hash their password, and publish a `user-registered` Kafka event.

**Definition of Done:**
- `POST /auth/register` with `{"username":"alice","email":"alice@test.com","password":"secret123"}` returns HTTP 201 with `{"user_id":"<uuid>","username":"alice"}`
- Password is stored hashed (bcrypt, cost factor ≥ 12) — plaintext password is never stored or logged
- Duplicate email returns HTTP 409 with `{"error":"email already registered"}`
- Duplicate username returns HTTP 409 with `{"error":"username already taken"}`
- After successful registration, a `user-registered` event with correct schema (T-03) is published to Kafka topic `user-registered`
- Kafka publish can be verified: `docker exec kafka kafka-console-consumer.sh --topic user-registered --bootstrap-server localhost:9092 --from-beginning` shows the event within 5 seconds

---

### T-21 · Auth: Login endpoint + JWT issuance
**Assignee:** Java Dev A | **Deadline:** Apr 27 | **Est:** 4h | **Deps:** T-19, T-20

**Description:** Implement `POST /auth/login` — verify credentials, issue access token (15 min) and refresh token (7 days).

**Definition of Done:**
- `POST /auth/login` with correct credentials returns HTTP 200 with `{"access_token":"<jwt>","refresh_token":"<uuid>","expires_in":900}`
- Wrong password returns HTTP 401 with `{"error":"invalid credentials"}`
- Unknown email returns HTTP 401 with same error (no user enumeration)
- Access token is a signed JWT with claims: `sub` (user_id), `username`, `exp`, `iat`
- Refresh token is stored in PostgreSQL table `refresh_tokens` with `user_id`, `token_hash`, `expires_at`
- `curl -X POST http://localhost:8081/auth/login -d '{"email":"alice@test.com","password":"secret123"}'` returns a token that passes validation by the shared auth middleware (T-05)

---

### T-22 · Auth: Token refresh endpoint
**Assignee:** Java Dev A | **Deadline:** Apr 28 | **Est:** 3h | **Deps:** T-21

**Description:** Implement `POST /auth/refresh` — exchange a valid refresh token for a new access token.

**Definition of Done:**
- `POST /auth/refresh` with `{"refresh_token":"<valid_token>"}` returns HTTP 200 with a new `access_token`
- Expired refresh token returns HTTP 401 with `{"error":"refresh token expired"}`
- Unknown or revoked refresh token returns HTTP 401
- Old refresh token is invalidated after use (rotation — one-time use)
- New access token is valid and accepted by the shared auth middleware

---

### T-23 · Auth: Logout endpoint
**Assignee:** Java Dev A | **Deadline:** Apr 28 | **Est:** 2h | **Deps:** T-21

**Description:** Implement `DELETE /auth/logout` — revoke the refresh token for the calling user.

**Definition of Done:**
- `DELETE /auth/logout` with valid `Authorization: Bearer <token>` returns HTTP 204
- The refresh token associated with the user is deleted from `refresh_tokens` table
- Subsequent `POST /auth/refresh` with the old refresh token returns HTTP 401
- Unauthenticated call returns HTTP 401

---

### T-24 · Auth: Get current user profile
**Assignee:** Java Dev A | **Deadline:** Apr 28 | **Est:** 2h | **Deps:** T-21

**Description:** Implement `GET /auth/me` — return the profile of the authenticated user.

**Definition of Done:**
- `GET /auth/me` with valid JWT returns HTTP 200 with `{"user_id":"<uuid>","username":"alice","email":"alice@test.com","created_at":"<iso8601>"}`
- No sensitive fields (password hash, refresh tokens) are exposed
- Unauthenticated call returns HTTP 401

---

### T-25 · Auth: Unit + integration tests
**Assignee:** Java Dev A | **Deadline:** May 1 | **Est:** 4h | **Deps:** T-20, T-21, T-22, T-23, T-24

**Description:** Write tests for all Auth endpoints using an in-memory H2 database or Testcontainers PostgreSQL.

**Definition of Done:**
- `./mvnw test` (or `./gradlew test`) passes with zero failures
- Tests cover: registration (success, duplicate email, duplicate username), login (success, wrong password), refresh (success, expired, unknown), logout, profile fetch
- Kafka publishing in T-20 is verified by a mocked Kafka producer (no real Kafka needed in unit tests)
- Test report generated at `target/surefire-reports/` or equivalent

---

## Epic 5 — Chat Service (Rust)

### T-26 · Chat: Project scaffold
**Assignee:** Rust Dev | **Deadline:** Apr 26 | **Est:** 4h | **Deps:** T-01

**Description:** Initialize the Chat service as a Rust (Axum or Actix-web) application with Cassandra connectivity and health endpoint.

**Definition of Done:**
- `services/chat/` contains a working Rust project (`Cargo.toml`) with a web server entry point
- Service reads `CASSANDRA_HOSTS`, `CASSANDRA_KEYSPACE` from environment and opens a session on startup
- Cassandra keyspace `discord_chat` and table `messages` exist (created via init CQL or migration)
- `GET /health` returns `{"status":"ok"}` with HTTP 200
- `cargo build --release` completes without errors
- Dockerfile exists at `services/chat/Dockerfile` and produces a runnable image

---

### T-27 · Chat: Send message endpoint
**Assignee:** Rust Dev | **Deadline:** Apr 27 | **Est:** 5h | **Deps:** T-05, T-26, T-40

**Description:** Implement `POST /channels/{channelId}/messages` — persist a message, call CheckPerm gRPC to verify write access, and publish `message-created` Kafka event.

**Definition of Done:**
- `POST /channels/{id}/messages` with valid JWT and body `{"content":"hello"}` returns HTTP 201 with `{"message_id":"<uuid>","channel_id":"<id>","author_id":"<user_id>","content":"hello","created_at":"<iso8601>"}`
- Before persisting, service calls `CheckPerm` gRPC with `action: WRITE`. If `allowed: false`, returns HTTP 403 with `{"error":"insufficient permissions"}`
- Message is persisted in Cassandra with `message_id` (UUID v7, time-ordered), `channel_id`, `author_id`, `content`, `created_at`
- `message-created` Kafka event is published within 1 second of successful insert
- Unauthenticated request returns HTTP 401

---

### T-28 · Chat: Get messages endpoint (paginated)
**Assignee:** Rust Dev | **Deadline:** Apr 28 | **Est:** 4h | **Deps:** T-26, T-27

**Description:** Implement `GET /channels/{channelId}/messages` with cursor-based pagination.

**Definition of Done:**
- `GET /channels/{id}/messages?limit=50` returns the 50 most recent messages, newest first
- Response shape: `{"messages":[...],"next_cursor":"<uuid>","has_more":true}`
- `GET /channels/{id}/messages?limit=50&before=<message_id>` returns messages older than that message_id
- Messages older than 30 days are still returned (no TTL filtering in this version)
- CheckPerm gRPC is called with `action: READ`; non-member gets HTTP 403
- Empty channel returns `{"messages":[],"has_more":false}`

---

### T-29 · Chat: Delete message endpoint
**Assignee:** Rust Dev | **Deadline:** Apr 28 | **Est:** 3h | **Deps:** T-26, T-27

**Description:** Implement `DELETE /channels/{channelId}/messages/{messageId}` — soft-delete (mark deleted) a message.

**Definition of Done:**
- `DELETE /channels/{id}/messages/{mid}` by the message author returns HTTP 204
- Deleting someone else's message returns HTTP 403 unless the requester has the MANAGE permission (CheckPerm gRPC)
- Deleted message is not returned in subsequent `GET /channels/{id}/messages` calls
- Deletion is a soft delete: `deleted_at` timestamp set in Cassandra, data retained
- Non-existent message_id returns HTTP 404

---

### T-30 · Chat: File attachment upload
**Assignee:** Rust Dev | **Deadline:** Apr 29 | **Est:** 5h | **Deps:** T-26, T-07

**Description:** Implement `POST /channels/{channelId}/attachments` — accept a file upload, store it in MinIO, and return the URL.

**Definition of Done:**
- `POST /channels/{id}/attachments` with multipart form-data (`file` field) returns HTTP 201 with `{"attachment_id":"<uuid>","url":"http://localhost:9000/attachments/<key>","filename":"<original>","size_bytes":<n>}`
- File is stored in MinIO bucket `attachments` under key `<channel_id>/<attachment_id>/<filename>`
- Maximum file size is 25 MB; exceeding it returns HTTP 413
- Attachment URL is publicly accessible: `curl <url>` downloads the file
- Accepted MIME types: image/*, video/mp4, application/pdf (others return HTTP 415)

---

### T-31 · Chat: Kafka consumer for mention fanout
**Assignee:** Rust Dev | **Deadline:** Apr 29 | **Est:** 3h | **Deps:** T-26, T-03, T-06

**Description:** Produce `mention` Kafka events when a message content contains `@username` patterns.

**Definition of Done:**
- On `POST /channels/{id}/messages`, the service parses `content` for `@<username>` patterns
- For each mention found, a `mention` Kafka event is published to topic `mention` with schema matching T-03
- If a message mentions 3 users, 3 separate `mention` events are published
- Mentions are validated against known user IDs (lookup via Auth Svc or a cached user registry — approach documented in code comments)
- Verified: `docker exec kafka kafka-console-consumer.sh --topic mention --bootstrap-server localhost:9092 --from-beginning` shows mention events after sending a message with `@alice`

---

### T-32 · Chat: WebSocket push for new messages
**Assignee:** Rust Dev | **Deadline:** Apr 30 | **Est:** 4h | **Deps:** T-26, T-27, T-48

**Description:** After persisting a new message, push it to all connected users in the channel via the Presence Svc session registry.

**Definition of Done:**
- After successful message insert, Chat Svc calls `GET http://presence:8086/sessions?channel_id={id}` to retrieve connected session IDs
- Chat Svc sends a `POST http://gateway:8080/internal/push` with `{session_ids:[...], event:{type:"new_message", payload:{...}}}` for fan-out
- Connected WebSocket clients receive the message event within 500ms of it being sent
- Verified end-to-end: two `wscat` clients connected to the same channel both receive the message when one of them sends via REST

---

### T-33 · Chat: Unit + integration tests
**Assignee:** Rust Dev | **Deadline:** May 1 | **Est:** 4h | **Deps:** T-27, T-28, T-29, T-30, T-31

**Description:** Write Rust tests covering Chat service endpoints and event publishing.

**Definition of Done:**
- `cargo test` passes with zero failures
- Tests cover: send message (success, no permission, unauthenticated), get messages (paginated, empty), delete (own, other's without permission), attachment upload (valid, too large, wrong type)
- Kafka event publishing tested with a mock producer
- Cassandra integration tests use a Testcontainers Cassandra instance or a test keyspace

---

## Epic 6 — Servers Service (Java/Kotlin)

### T-34 · Servers: Project scaffold
**Assignee:** Java Dev B | **Deadline:** Apr 26 | **Est:** 3h | **Deps:** T-01

**Description:** Initialize the Servers service as a Spring Boot application with PostgreSQL connectivity.

**Definition of Done:**
- `services/servers/` contains a working Maven/Gradle Spring Boot project
- Service connects to PostgreSQL using env vars `POSTGRES_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- Flyway migrations create tables: `servers`, `channels`, `memberships`, `roles`, `permissions`
- `GET /health` returns `{"status":"ok"}` with HTTP 200
- `./mvnw package -DskipTests` completes without errors
- Dockerfile at `services/servers/Dockerfile` builds and runs

---

### T-35 · Servers: Server CRUD endpoints
**Assignee:** Java Dev B | **Deadline:** Apr 27 | **Est:** 4h | **Deps:** T-34

**Description:** Implement create, read, update, and delete for servers (Discord's "guilds").

**Definition of Done:**
- `POST /servers` with `{"name":"My Server"}` returns HTTP 201 with `{"server_id":"<uuid>","name":"My Server","owner_id":"<user_id>","created_at":"<iso8601>"}`
- `GET /servers` returns all servers the authenticated user is a member of
- `GET /servers/{id}` returns HTTP 200 with server details, or 404 if not found
- `PUT /servers/{id}` updates server name; only owner returns HTTP 200, others HTTP 403
- `DELETE /servers/{id}` soft-deletes server; only owner can do it; returns HTTP 204
- Creating a server automatically adds the creator as owner/member in `memberships`

---

### T-36 · Servers: Channel CRUD endpoints
**Assignee:** Java Dev B | **Deadline:** Apr 28 | **Est:** 4h | **Deps:** T-34, T-35

**Description:** Implement create, read, update, and delete for channels within a server.

**Definition of Done:**
- `POST /servers/{id}/channels` with `{"name":"general","type":"TEXT"}` returns HTTP 201 with channel object
- `GET /servers/{id}/channels` returns all channels in the server (only if user is a member)
- `PUT /servers/{id}/channels/{cid}` updates channel name/type; requires MANAGE permission
- `DELETE /servers/{id}/channels/{cid}` soft-deletes channel; requires MANAGE permission; returns HTTP 204
- Channel types supported: `TEXT`, `VOICE`
- Non-member accessing a server's channels returns HTTP 403

---

### T-37 · Servers: Membership management
**Assignee:** Java Dev B | **Deadline:** Apr 28 | **Est:** 3h | **Deps:** T-34, T-35

**Description:** Implement joining and leaving servers (member management).

**Definition of Done:**
- `POST /servers/{id}/join` adds the authenticated user to `memberships`; returns HTTP 200
- `DELETE /servers/{id}/leave` removes the user from `memberships`; owner cannot leave; returns HTTP 204
- Joining a server already joined returns HTTP 409 with `{"error":"already a member"}`
- `GET /servers/{id}/members` returns list of members with `user_id` and `username`
- Leaving a server removes access to all its channels (enforced by CheckPerm)

---

### T-38 · Servers: Roles and permissions model
**Assignee:** Java Dev B | **Deadline:** Apr 29 | **Est:** 5h | **Deps:** T-34, T-35, T-37

**Description:** Implement the role/permission system: each server has roles, each role has permissions, each member has roles.

**Definition of Done:**
- Database tables `roles` and `role_permissions` are created and populated with a default `@everyone` role on server creation
- `POST /servers/{id}/roles` creates a new role; returns HTTP 201
- `PUT /servers/{id}/members/{userId}/roles` assigns a role to a member; requires MANAGE permission
- Permissions supported: `READ`, `WRITE`, `VOICE_JOIN`, `MANAGE`
- Default `@everyone` role has `READ` and `WRITE` for all channels; owner has all permissions
- Permission changes take effect immediately for subsequent CheckPerm gRPC calls

---

### T-39 · Servers: Kafka consumer for user-registered
**Assignee:** Java Dev B | **Deadline:** Apr 29 | **Est:** 2h | **Deps:** T-03, T-34, T-06

**Description:** Subscribe to the `user-registered` Kafka topic to cache user information locally for permission lookups.

**Definition of Done:**
- Servers Svc consumes `user-registered` events from Kafka topic on startup
- On each event, the user's `user_id` and `username` are upserted into a local `users_cache` table in PostgreSQL
- Consumer group ID is `servers-svc-user-registry`
- If Kafka is unavailable on startup, service starts anyway and logs a warning (consumer reconnects automatically)
- Verified: register a new user via Auth Svc, then `SELECT * FROM users_cache WHERE user_id = '<id>'` in the Servers DB returns a row within 5 seconds

---

### T-40 · Servers: Implement CheckPerm gRPC server
**Assignee:** Java Dev B | **Deadline:** Apr 30 | **Est:** 5h | **Deps:** T-02, T-34, T-38

**Description:** Implement the `PermService.CheckPerm` gRPC endpoint — the single cross-service dependency that Gateway, Chat, and Voice all call.

**Definition of Done:**
- `services/servers/` exposes a gRPC server on port 50051 (configurable via `GRPC_PORT` env var)
- `CheckPerm(user_id, server_id, channel_id, action)` looks up the user's roles in `memberships` and `role_permissions`
- Returns `{allowed: true}` if any of the user's roles grant the requested action on that channel
- Returns `{allowed: false, reason: "not a member"}` if user is not in `memberships`
- Returns `{allowed: false, reason: "insufficient permissions"}` if member but no permission
- Verified with `grpcurl -plaintext localhost:50051 PermService/CheckPerm -d '{"user_id":"<id>","server_id":"<id>","channel_id":"<id>","action":"READ"}'`
- Response latency < 50ms for cached lookups (use Spring Cache or Caffeine in-process cache for role lookups)

---

### T-41-servers · Servers: Unit + integration tests
**Assignee:** Java Dev B | **Deadline:** May 1 | **Est:** 4h | **Deps:** T-35, T-36, T-37, T-38, T-39, T-40

**Description:** Write tests for all Servers service endpoints and the CheckPerm gRPC server.

**Definition of Done:**
- `./mvnw test` passes with zero failures
- Tests cover: server CRUD, channel CRUD, membership join/leave, role assignment, CheckPerm (member with permission, member without, non-member)
- gRPC server tested with an in-process gRPC client
- Testcontainers PostgreSQL used for integration tests (no mocked DB)

---

## Epic 7 — Voice Service (Python)

### T-41 · Voice: Project scaffold
**Assignee:** Python Dev | **Deadline:** Apr 26 | **Est:** 3h | **Deps:** T-01

**Description:** Initialize the Voice service as a Python (FastAPI) application with Redis connectivity.

**Definition of Done:**
- `services/voice/` contains `pyproject.toml` (or `requirements.txt`) and a FastAPI entry point
- Service reads `REDIS_ADDR` from environment and opens a Redis connection on startup
- `GET /health` returns `{"status":"ok"}` with HTTP 200
- `uvicorn main:app` starts without errors
- Dockerfile at `services/voice/Dockerfile` builds and produces a runnable image

---

### T-42 · Voice: Join voice channel
**Assignee:** Python Dev | **Deadline:** Apr 27 | **Est:** 4h | **Deps:** T-05, T-41, T-40

**Description:** Implement `POST /voice/{channelId}/join` — authenticate user, verify permission, register in Redis session.

**Definition of Done:**
- `POST /voice/{channelId}/join` with valid JWT returns HTTP 200 with `{"session_id":"<uuid>","channel_id":"<id>","user_id":"<id>","joined_at":"<iso8601>"}`
- Before joining, service calls `CheckPerm` gRPC with `action: VOICE_JOIN`. If `allowed: false`, returns HTTP 403
- User session stored in Redis key `voice:channel:{channelId}:users` as a sorted set (score = join timestamp)
- A user joining a channel they're already in returns HTTP 200 (idempotent, refreshes TTL)
- Unauthenticated request returns HTTP 401
- Redis entry has TTL of 4 hours (auto-expire for disconnected users)

---

### T-43 · Voice: Leave voice channel
**Assignee:** Python Dev | **Deadline:** Apr 27 | **Est:** 2h | **Deps:** T-41, T-42

**Description:** Implement `POST /voice/{channelId}/leave` — remove user from voice session.

**Definition of Done:**
- `POST /voice/{channelId}/leave` with valid JWT returns HTTP 204
- User is removed from Redis sorted set `voice:channel:{channelId}:users`
- If user is not currently in the channel, returns HTTP 204 (idempotent)
- `GET /voice/{channelId}/participants` after leaving does not include the user

---

### T-44 · Voice: List participants in voice channel
**Assignee:** Python Dev | **Deadline:** Apr 28 | **Est:** 2h | **Deps:** T-41, T-42

**Description:** Implement `GET /voice/{channelId}/participants` — return all users currently in the voice channel.

**Definition of Done:**
- `GET /voice/{channelId}/participants` returns HTTP 200 with `{"channel_id":"<id>","participants":[{"user_id":"<id>","joined_at":"<iso8601>"},...]}`
- Only members with `VOICE_JOIN` permission can view participants (CheckPerm gRPC with `action: READ`)
- Empty channel returns `{"participants":[]}`
- Participants list refreshes in real time (reads live from Redis)

---

### T-45 · Voice: WebRTC signaling (offer/answer/ICE)
**Assignee:** Python Dev | **Deadline:** Apr 29 | **Est:** 6h | **Deps:** T-41, T-42, T-14

**Description:** Implement WebSocket-based WebRTC signaling endpoint so clients can negotiate peer connections for voice.

**Definition of Done:**
- `GET /voice/{channelId}/signal` upgrades to WebSocket with valid JWT
- Clients can send signaling messages: `{"type":"offer","sdp":"..."}`, `{"type":"answer","sdp":"..."}`, `{"type":"ice-candidate","candidate":"..."}`
- Signaling messages are relayed to the target peer identified by `target_user_id` in the message payload
- If target peer is not connected, returns `{"type":"error","reason":"peer not connected"}`
- Two browser tabs can establish a WebRTC peer connection using this signaling server (verified manually)
- Connection state cleaned up from Redis on WebSocket close

---

### T-46 · Voice: WebSocket push — participant joined/left events
**Assignee:** Python Dev | **Deadline:** Apr 30 | **Est:** 3h | **Deps:** T-41, T-42, T-43, T-45

**Description:** Push real-time events to all participants in a voice channel when someone joins or leaves.

**Definition of Done:**
- When a user joins, all existing participants receive `{"type":"participant_joined","user_id":"<id>"}` within 500ms
- When a user leaves, all existing participants receive `{"type":"participant_left","user_id":"<id>"}` within 500ms
- Events are delivered only to users currently connected to the channel's signaling WebSocket
- No event is sent if there are no other participants

---

### T-47 · Voice: Unit + integration tests
**Assignee:** Python Dev | **Deadline:** May 1 | **Est:** 3h | **Deps:** T-42, T-43, T-44, T-45, T-46

**Description:** Write pytest tests for all Voice endpoints.

**Definition of Done:**
- `pytest` in `services/voice/` passes with zero failures
- Tests cover: join (success, no permission), leave (success, idempotent), participants list, signaling relay
- Redis interactions tested with `fakeredis` or a Testcontainers Redis instance
- gRPC CheckPerm calls mocked in unit tests

---

## Epic 8 — Presence Service (Go)

### T-48 · Presence: Project scaffold
**Assignee:** Go Dev | **Deadline:** Apr 26 | **Est:** 3h | **Deps:** T-01

**Description:** Initialize the Presence service as a Go application with Redis for session storage.

**Definition of Done:**
- `services/presence/` contains a Go module with a FastHTTP or standard `net/http` entry point
- Service reads `REDIS_ADDR` from environment and connects on startup
- `GET /health` returns `{"status":"ok"}` with HTTP 200
- `go build ./...` succeeds
- Dockerfile at `services/presence/Dockerfile` builds successfully

---

### T-49 · Presence: Register WebSocket session
**Assignee:** Go Dev | **Deadline:** Apr 27 | **Est:** 3h | **Deps:** T-48

**Description:** Implement `POST /sessions` — called by Gateway when a user opens a WebSocket connection.

**Definition of Done:**
- `POST /sessions` with body `{"user_id":"<id>","connection_id":"<uuid>","subscribed_channels":["<id>",...]}` returns HTTP 200 with `{"session_id":"<uuid>"}`
- Session stored in Redis as hash `presence:session:{connection_id}` with fields: `user_id`, `connection_id`, `subscribed_channels`, `connected_at`
- User presence stored in Redis set `presence:user:{user_id}:sessions` containing all active connection_ids for that user
- Session TTL: 30 minutes (refreshed by heartbeat — see T-51)
- Duplicate `connection_id` overwrites the previous entry (idempotent)

---

### T-50 · Presence: Deregister WebSocket session
**Assignee:** Go Dev | **Deadline:** Apr 27 | **Est:** 2h | **Deps:** T-48, T-49

**Description:** Implement `DELETE /sessions/{connectionId}` — called by Gateway on WebSocket disconnect.

**Definition of Done:**
- `DELETE /sessions/{connection_id}` returns HTTP 204
- Redis keys `presence:session:{connection_id}` and the entry in `presence:user:{user_id}:sessions` are deleted
- If `connection_id` not found, returns HTTP 204 (idempotent)
- After deletion, `GET /sessions?user_id={id}` does not include the deleted session

---

### T-51 · Presence: Heartbeat / session refresh
**Assignee:** Go Dev | **Deadline:** Apr 28 | **Est:** 2h | **Deps:** T-48, T-49

**Description:** Implement `PUT /sessions/{connectionId}/heartbeat` — reset the session TTL so it doesn't expire for active connections.

**Definition of Done:**
- `PUT /sessions/{connection_id}/heartbeat` returns HTTP 200 and resets TTL to 30 minutes
- Unknown `connection_id` returns HTTP 404
- Gateway sends a heartbeat every 2 minutes per connection (Gateway-side behavior)
- Sessions expire automatically in Redis if no heartbeat is received for 30 minutes

---

### T-52 · Presence: Query sessions by channel
**Assignee:** Go Dev | **Deadline:** Apr 28 | **Est:** 3h | **Deps:** T-48, T-49

**Description:** Implement `GET /sessions?channel_id={id}` — return all connection_ids subscribed to a channel (used by Chat Svc for fan-out).

**Definition of Done:**
- `GET /sessions?channel_id={id}` returns HTTP 200 with `{"sessions":[{"connection_id":"<id>","user_id":"<id>"},...]}`
- Only sessions whose `subscribed_channels` list includes the given `channel_id` are returned
- Empty result returns `{"sessions":[]}`
- Response time < 20ms for up to 1000 active sessions (verified with `hey` or similar load tool)

---

### T-53 · Presence: Query sessions by user
**Assignee:** Go Dev | **Deadline:** Apr 29 | **Est:** 2h | **Deps:** T-48, T-49

**Description:** Implement `GET /sessions?user_id={id}` — return all active sessions for a user (used to determine online/offline status).

**Definition of Done:**
- `GET /sessions?user_id={id}` returns HTTP 200 with `{"user_id":"<id>","online":true,"sessions":[...]}`
- `online: false` and empty `sessions` array if user has no active sessions
- `online: true` if at least one active session exists

---

### T-54 · Presence: Unit + integration tests
**Assignee:** Go Dev | **Deadline:** May 1 | **Est:** 3h | **Deps:** T-49, T-50, T-51, T-52, T-53

**Description:** Write Go tests for Presence service.

**Definition of Done:**
- `go test ./...` passes with zero failures
- Tests cover: register (success, duplicate), deregister (success, idempotent), heartbeat (success, unknown), query by channel, query by user (online/offline)
- Redis interactions tested with `miniredis` or Testcontainers Redis

---

## Epic 9 — Tips Service (Python)

### T-55 · Tips: Project scaffold
**Assignee:** Python Dev | **Deadline:** Apr 26 | **Est:** 2h | **Deps:** T-01

**Description:** Initialize the Tips service as a Python (FastAPI) application with PostgreSQL connectivity.

**Definition of Done:**
- `services/tips/` contains `pyproject.toml` and a FastAPI entry point
- Service connects to PostgreSQL using env vars `POSTGRES_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- Alembic migrations create `tips` table with: `tip_id`, `sender_id`, `recipient_id`, `amount_cents`, `currency`, `message`, `created_at`
- `GET /health` returns `{"status":"ok"}` with HTTP 200
- Dockerfile at `services/tips/Dockerfile` builds and runs

---

### T-56 · Tips: Send tip endpoint
**Assignee:** Python Dev | **Deadline:** Apr 28 | **Est:** 4h | **Deps:** T-55

**Description:** Implement `POST /tips` — create a tip from one user to another.

**Definition of Done:**
- `POST /tips` with valid JWT and body `{"recipient_id":"<uuid>","amount_cents":500,"currency":"USD","message":"Great help!"}` returns HTTP 201 with the tip object
- `sender_id` is extracted from the JWT (not from the request body)
- Sender cannot tip themselves; returns HTTP 400 with `{"error":"cannot tip yourself"}`
- `amount_cents` must be > 0; otherwise returns HTTP 400 with `{"error":"amount must be positive"}`
- Tip is persisted in PostgreSQL and returned with generated `tip_id` and `created_at`

---

### T-57 · Tips: List tips endpoint
**Assignee:** Python Dev | **Deadline:** Apr 29 | **Est:** 3h | **Deps:** T-55, T-56

**Description:** Implement `GET /tips` — return tips sent and received by the authenticated user.

**Definition of Done:**
- `GET /tips?direction=sent` returns tips where `sender_id = <current_user_id>`, ordered by `created_at` desc
- `GET /tips?direction=received` returns tips where `recipient_id = <current_user_id>`, ordered by `created_at` desc
- `GET /tips` without `direction` returns all tips involving the user (sent and received)
- Supports `?limit=20&offset=0` pagination
- Each tip object includes: `tip_id`, `sender_id`, `recipient_id`, `amount_cents`, `currency`, `message`, `created_at`
- `GET /tips/{id}` returns a single tip; returns 404 if not found or not involving the user

---

### T-58 · Tips: Unit + integration tests
**Assignee:** Python Dev | **Deadline:** May 1 | **Est:** 2h | **Deps:** T-56, T-57

**Description:** Write pytest tests for the Tips service.

**Definition of Done:**
- `pytest` passes with zero failures
- Tests cover: send tip (success, self-tip, zero amount), list sent/received, get by ID (found, not found, not authorized)
- Testcontainers PostgreSQL or SQLite used for integration tests

---

## Epic 10 — Web App (JavaScript / Next.js)

### T-59 · Web App: Project scaffold + routing
**Assignee:** JS Dev | **Deadline:** Apr 26 | **Est:** 3h | **Deps:** T-01, T-04

**Description:** Initialize the Next.js project with App Router, TypeScript, and Tailwind CSS. Define the top-level page routes.

**Definition of Done:**
- `apps/web-app/` contains a working Next.js 14+ project with TypeScript and Tailwind
- Routes defined: `/login`, `/register`, `/app` (layout with server list sidebar), `/app/servers/[id]`, `/app/servers/[id]/channels/[cid]`
- `npm run dev` starts without errors at `localhost:3000`
- `npm run build` succeeds with no TypeScript errors and no missing page warnings
- All routes render without console errors in the browser (they can show placeholder content)

---

### T-60 · Web App: Auth flows (login, register, logout)
**Assignee:** JS Dev | **Deadline:** Apr 27 | **Est:** 4h | **Deps:** T-59, T-21, T-20

**Description:** Implement login, register, and logout forms that call the Gateway API and store the JWT.

**Definition of Done:**
- `/register` form: fields for username, email, password. On submit, calls `POST /auth/register`. On success, redirects to `/login`. On error, shows server-provided error message inline.
- `/login` form: fields for email, password. On submit, calls `POST /auth/login`. On success, stores `access_token` in an HttpOnly cookie and redirects to `/app`.
- Logout button: calls `DELETE /auth/logout`, clears cookie, redirects to `/login`
- Accessing `/app/*` while unauthenticated redirects to `/login`
- Token refresh: if an API call returns 401, silently calls `POST /auth/refresh` and retries the request once

---

### T-61 · Web App: Server list sidebar
**Assignee:** JS Dev | **Deadline:** Apr 27 | **Est:** 3h | **Deps:** T-59, T-35

**Description:** Implement the left sidebar showing all servers the user is a member of.

**Definition of Done:**
- Sidebar calls `GET /servers` on page load and renders one icon per server
- Clicking a server icon navigates to `/app/servers/{id}`
- "Create Server" button opens a modal with a name field; on submit calls `POST /servers` and adds the new server to the list without a full page reload
- Active server is visually highlighted
- Loading state shown while fetching servers
- Error state shown if the API call fails, with a retry button

---

### T-62 · Web App: Channel list + server detail
**Assignee:** JS Dev | **Deadline:** Apr 28 | **Est:** 3h | **Deps:** T-59, T-36

**Description:** Implement the channel list panel for the selected server.

**Definition of Done:**
- Navigating to `/app/servers/{id}` calls `GET /servers/{id}/channels` and renders channels grouped by type (TEXT, VOICE)
- Clicking a text channel navigates to `/app/servers/{id}/channels/{cid}`
- "Create Channel" button (visible to server owners/managers) opens a modal; submits `POST /servers/{id}/channels`
- Newly created channel appears in the list immediately without page reload
- Loading and error states handled

---

### T-63 · Web App: Chat view — message list
**Assignee:** JS Dev | **Deadline:** Apr 28 | **Est:** 4h | **Deps:** T-59, T-28

**Description:** Implement the main chat area showing messages for the selected channel.

**Definition of Done:**
- Channel view calls `GET /channels/{id}/messages?limit=50` and renders messages with: avatar placeholder, username, timestamp, content
- Messages are displayed newest at the bottom (chronological order)
- Infinite scroll: scrolling to the top loads 50 more messages using the `before` cursor
- Delete button shown on own messages; calls `DELETE /channels/{id}/messages/{mid}` and removes the message from the list
- Loading spinner shown while fetching initial messages

---

### T-64 · Web App: Chat view — send message + real-time updates
**Assignee:** JS Dev | **Deadline:** Apr 29 | **Est:** 5h | **Deps:** T-59, T-27, T-14, T-32

**Description:** Implement the message input box and WebSocket connection for real-time message delivery.

**Definition of Done:**
- Message input at the bottom of the chat; pressing Enter or clicking Send calls `POST /channels/{id}/messages`
- Sent message appears immediately in the list (optimistic update), confirmed when API returns 201
- WebSocket connection opened at `ws://localhost:8080/ws` on page load (with JWT)
- Incoming `new_message` events from WebSocket add messages to the current channel's list in real time without refresh
- File attachment: paperclip icon opens file picker; selected file is uploaded via `POST /channels/{id}/attachments`; attachment URL appended to message content
- WebSocket reconnects automatically on disconnect (exponential backoff, max 30s)

---

### T-65 · Web App: Voice channel UI
**Assignee:** JS Dev | **Deadline:** Apr 30 | **Est:** 5h | **Deps:** T-59, T-42, T-43, T-44, T-45

**Description:** Implement the voice channel join/leave UI and WebRTC audio using the Voice Svc signaling.

**Definition of Done:**
- Clicking a VOICE channel shows a "Join Voice" button
- Clicking Join calls `POST /voice/{channelId}/join`, then opens WebSocket to `ws://localhost:8080/voice/{channelId}/signal`
- Browser microphone permission is requested; on grant, a WebRTC `RTCPeerConnection` is created
- Offer/answer/ICE messages are exchanged via the signaling WebSocket
- Other participants' audio is played back in real time (verify with two browser tabs)
- Participant list panel shows who is in the voice channel (from `GET /voice/{channelId}/participants`)
- Leave button calls `POST /voice/{channelId}/leave` and closes WebRTC connection

---

### T-66 · Web App: Tips UI
**Assignee:** JS Dev | **Deadline:** Apr 30 | **Est:** 3h | **Deps:** T-59, T-56, T-57

**Description:** Implement a tip sending flow and tips history page.

**Definition of Done:**
- "Send Tip" button on a user's profile/context menu opens a modal with: recipient username (pre-filled), amount field, currency selector, optional message
- On submit, calls `POST /tips`; success shows a confirmation toast; error shows inline message
- `/app/tips` page shows two tabs: "Sent" and "Received"; each tab calls `GET /tips?direction=sent` or `received` and renders tip rows with amount, user, date, message
- Pagination: "Load more" button at the bottom of each tab
- Sending a tip to yourself shows "Cannot tip yourself" error inline

---

### T-67 · Web App: Unit + E2E tests
**Assignee:** JS Dev | **Deadline:** May 1 | **Est:** 4h | **Deps:** T-60, T-61, T-62, T-63, T-64

**Description:** Write React Testing Library unit tests and at least one Playwright E2E test covering the critical auth + chat path.

**Definition of Done:**
- `npm test` passes with zero failures
- Unit tests cover: login form validation (empty fields, server error), message list rendering (messages shown, empty state), send message (calls correct API, optimistic update)
- E2E test (Playwright): registers a user → logs in → joins a server → opens a text channel → sends a message → message appears in the channel list
- E2E test runs against the full docker-compose stack: `npx playwright test` passes

---

## Epic 11 — Desktop App (Electron + Next.js)

### T-68 · Desktop: Next.js static export config
**Assignee:** JS Dev | **Deadline:** Apr 28 | **Est:** 2h | **Deps:** T-59

**Description:** Configure the Web App to export as a static site that can be loaded by Electron.

**Definition of Done:**
- `apps/web-app/next.config.js` sets `output: 'export'` and `trailingSlash: true`
- `npm run build` produces a `out/` directory with static HTML/CSS/JS files
- All routes (login, register, app, servers, channels) are exported as static pages
- No server-side rendering or API routes remain (all data fetching moves to client-side hooks)
- `npx serve out/` (or similar) loads the app in a browser without 404s on direct URL access

---

### T-69 · Desktop: Electron scaffold
**Assignee:** JS Dev | **Deadline:** Apr 28 | **Est:** 3h | **Deps:** T-01

**Description:** Initialize the Electron project in `apps/desktop-app/` with a main process that loads the Next.js static export.

**Definition of Done:**
- `apps/desktop-app/` contains `package.json` with Electron as a dependency and a `main.js` entry point
- `main.js` creates a `BrowserWindow` and loads the Next.js static export from `apps/web-app/out/index.html`
- `npm start` in `apps/desktop-app/` opens the Electron window showing the Web App
- Window has a minimum size of 1024×768
- Electron DevTools can be opened via View menu or Cmd+Shift+I

---

### T-70 · Desktop: API URL configuration for desktop
**Assignee:** JS Dev | **Deadline:** Apr 29 | **Est:** 2h | **Deps:** T-68, T-69

**Description:** Ensure the Desktop App calls the Gateway at the correct URL (localhost) rather than a relative path.

**Definition of Done:**
- All API calls in the Web App use `process.env.NEXT_PUBLIC_API_URL` for the base URL
- When building for Electron, `NEXT_PUBLIC_API_URL=http://localhost:8080` is set at build time
- API calls work from within the Electron window: login, fetch servers, send message all succeed
- WebSocket connects to `ws://localhost:8080/ws` from within Electron

---

### T-71 · Desktop: System tray integration
**Assignee:** JS Dev | **Deadline:** Apr 30 | **Est:** 3h | **Deps:** T-69

**Description:** Add a system tray icon so the app can be minimized to tray and restored.

**Definition of Done:**
- Closing the window minimizes to system tray instead of quitting (on macOS and Windows)
- Tray icon has a context menu with: "Open" (restores window), "Quit" (exits app)
- Tray icon is present at `apps/desktop-app/assets/tray-icon.png` (16x16 and 32x32)
- Double-clicking the tray icon restores the main window
- `npm start` shows the tray icon after the app starts

---

### T-72 · Desktop: Native desktop notifications
**Assignee:** JS Dev | **Deadline:** Apr 30 | **Est:** 3h | **Deps:** T-69, T-14

**Description:** Trigger native OS notifications when the user receives a mention while the window is minimized.

**Definition of Done:**
- When a `mention` WebSocket event is received and the Electron window is not focused, a native notification is shown with: title "Mentioned in #{channel-name}", body showing the first 100 chars of the message
- Clicking the notification brings the Electron window to focus and navigates to the mentioned channel
- Notifications can be disabled via an in-app toggle (preference stored in `electron-store`)
- On macOS, notification permission is requested on first launch

---

### T-73 · Desktop: Package and build script
**Assignee:** JS Dev | **Deadline:** May 1 | **Est:** 2h | **Deps:** T-68, T-69, T-70, T-71

**Description:** Add an `electron-builder` config to package the app as a distributable for macOS (`.dmg`) and Windows (`.exe`).

**Definition of Done:**
- `package.json` in `apps/desktop-app/` includes `electron-builder` config with app name, version, icon, and output directory
- `npm run dist` builds the Next.js static export, then packages Electron app
- Output artifacts produced in `apps/desktop-app/dist/`: `.dmg` for macOS, `.exe` for Windows
- The packaged app launches, logs in, and can send a message (tested manually on at least one OS)

---

## Epic 12 — Integration & End-to-End Testing

### T-74 · Integration: Full stack smoke test
**Assignee:** Tech Lead | **Deadline:** May 1 | **Est:** 3h | **Deps:** T-08, T-21, T-27, T-40, T-42

**Description:** Run a scripted smoke test against the full docker-compose stack to verify all services are wired correctly.

**Definition of Done:**
- Shell script `infra/smoke-test.sh` exists and is executable
- Script performs these steps in order and exits non-zero on any failure:
  1. `docker-compose up -d --build` — all services start
  2. Wait for all health checks to pass (poll `GET /health` on each service)
  3. Register user via `POST /auth/register`
  4. Login via `POST /auth/login`, capture JWT
  5. Create server via `POST /servers`
  6. Create channel via `POST /servers/{id}/channels`
  7. Join voice channel via `POST /voice/{channelId}/join`
  8. Send message via `POST /channels/{id}/messages`
  9. Fetch messages via `GET /channels/{id}/messages` — assert message is present
  10. Leave voice via `POST /voice/{channelId}/leave`
- Running `bash infra/smoke-test.sh` exits 0 on a clean environment

---

### T-75 · Integration: Kafka event flow verification
**Assignee:** Tech Lead | **Deadline:** May 1 | **Est:** 2h | **Deps:** T-20, T-27, T-31, T-39

**Description:** Verify that all three Kafka topics carry events end-to-end across services.

**Definition of Done:**
- `user-registered` event: Register a user → within 5s, event appears in `kafka-console-consumer --topic user-registered` AND Servers Svc `users_cache` table contains the new user
- `message-created` event: Send a message → within 5s, event appears in `kafka-console-consumer --topic message-created`
- `mention` event: Send a message with `@alice` → within 5s, event appears in `kafka-console-consumer --topic mention` with correct `mentioned_user_id`
- A `KAFKA_EVENTS.md` file documents how to manually verify each topic using `kafka-console-consumer`

---

### T-76 · Integration: gRPC CheckPerm end-to-end
**Assignee:** Tech Lead | **Deadline:** May 1 | **Est:** 2h | **Deps:** T-40, T-27, T-42

**Description:** Verify that permission enforcement via gRPC works across Chat, Voice, and Gateway.

**Definition of Done:**
- User A creates a server; user B is NOT a member
- User B attempts `POST /channels/{id}/messages` → receives HTTP 403
- User B attempts `POST /voice/{channelId}/join` → receives HTTP 403
- Tech lead adds user B to server via `POST /servers/{id}/join`
- User B re-attempts both calls → both succeed (HTTP 201 and HTTP 200)
- Verified: Servers gRPC server logs the CheckPerm calls in structured format

---

### T-77 · Integration: WebSocket real-time message delivery
**Assignee:** Tech Lead | **Deadline:** May 2 | **Est:** 3h | **Deps:** T-14, T-32, T-52, T-64

**Description:** Verify end-to-end WebSocket fan-out: message sent by user A appears in user B's WebSocket stream.

**Definition of Done:**
- User A and User B both connect to `ws://localhost:8080/ws` with valid JWTs
- Both are subscribed to the same channel (Presence Svc registers both sessions)
- User A sends a message via `POST /channels/{id}/messages`
- User B's WebSocket receives `{"type":"new_message","payload":{...}}` within 500ms
- Verified with two simultaneous `wscat` terminal sessions
- Test is documented in `infra/WS_TEST.md` with step-by-step commands

---

### T-78 · Integration: Voice WebRTC manual verification
**Assignee:** Tech Lead + Python Dev | **Deadline:** May 2 | **Est:** 3h | **Deps:** T-42, T-45, T-65

**Description:** Manually verify that two browser clients can establish a WebRTC audio connection via the Voice Svc signaling.

**Definition of Done:**
- Two browser windows (different user accounts) both join the same voice channel in the Web App
- Both browsers show each other in the participants list
- Audio from one browser is audible in the other (microphone access granted)
- Leaving from one browser removes that user from the participants list in real time
- Test documented in `infra/VOICE_TEST.md` with step-by-step instructions

---

### T-79 · Integration: Desktop App end-to-end
**Assignee:** JS Dev | **Deadline:** May 2 | **Est:** 3h | **Deps:** T-73, T-74

**Description:** Verify the packaged Desktop App works against the full local stack.

**Definition of Done:**
- Packaged Desktop App (from T-73) is launched on the developer's machine
- User can log in, see server list, navigate to a channel, send a message, and receive a real-time message from another user (via Web App)
- Mention notification appears as a native OS notification when window is minimized
- No console errors in Electron DevTools during normal use

---

### T-80 · Integration: Load test — 50 concurrent WebSocket connections
**Assignee:** Go Dev | **Deadline:** May 2 | **Est:** 3h | **Deps:** T-14, T-32, T-52

**Description:** Run a load test to verify the Gateway and Presence service handle 50 concurrent WebSocket connections without crashes or message loss.

**Definition of Done:**
- Load test script `infra/load-test-ws.js` (or similar) opens 50 WebSocket connections, each with a unique valid JWT
- Each connection sends a message every 10 seconds for 2 minutes
- At end of test: 0 crashed connections, 0 goroutine leaks in Gateway (checked via pprof), all messages were delivered
- Gateway and Presence service memory usage stays below 512 MB each during the test
- Results logged to `infra/load-test-results.txt`

---

### T-81 · Documentation: Deployment and development guide
**Assignee:** Tech Lead | **Deadline:** May 3 | **Est:** 3h | **Deps:** T-74, T-75, T-76, T-77

**Description:** Write the final developer guide so any team member can onboard, run the full stack, and run all tests.

**Definition of Done:**
- Root `README.md` contains:
  - Prerequisites (Docker, docker-compose, Go, Node.js, Java 21, Rust, Python 3.11+)
  - One-command startup: `cp infra/.env.example infra/.env && docker-compose up --build`
  - How to run each service's tests individually
  - How to run the smoke test (`bash infra/smoke-test.sh`)
  - Service port map table (gateway: 8080, auth: 8081, chat: 8083, servers: 8082, voice: 8084, presence: 8086, tips: 8085, web: 3000)
  - Kafka topic and gRPC endpoint quick-reference
- Any team member following the README can run the full stack on a fresh machine in under 15 minutes

---

## Summary Table

| ID | Title | Assignee | Deadline | Est | Deps |
|----|-------|----------|----------|-----|------|
| T-01 | Bootstrap monorepo | Tech Lead | Apr 23 | 3h | — |
| T-02 | gRPC proto: CheckPerm | Tech Lead | Apr 24 | 4h | T-01 |
| T-03 | Kafka schemas | Tech Lead | Apr 24 | 3h | T-01 |
| T-04 | OpenAPI spec | Tech Lead | Apr 25 | 5h | T-01 |
| T-05 | Shared auth middleware | Tech Lead | Apr 25 | 4h | T-02, T-04 |
| T-06 | docker-compose: Kafka | Tech Lead | Apr 24 | 2h | T-01 |
| T-07 | docker-compose: Databases | Tech Lead | Apr 24 | 3h | T-01 |
| T-08 | docker-compose: All services | Tech Lead | Apr 26 | 4h | T-06, T-07 |
| T-09 | docker-compose: Web App | Tech Lead | Apr 26 | 2h | T-08 |
| T-10 | Env vars documentation | Tech Lead | Apr 26 | 2h | T-08, T-09 |
| T-11 | Gateway: scaffold | Go Dev | Apr 26 | 3h | T-01, T-04 |
| T-12 | Gateway: JWT middleware | Go Dev | Apr 27 | 3h | T-05, T-11 |
| T-13 | Gateway: reverse proxy | Go Dev | Apr 27 | 4h | T-11, T-12 |
| T-14 | Gateway: WebSocket + Presence | Go Dev | Apr 28 | 5h | T-11, T-12 |
| T-15 | Gateway: rate limiting | Go Dev | Apr 29 | 3h | T-12, T-13 |
| T-16 | Gateway: CORS | Go Dev | Apr 29 | 1h | T-11 |
| T-17 | Gateway: request logging | Go Dev | Apr 29 | 2h | T-11 |
| T-18 | Gateway: tests | Go Dev | May 1 | 4h | T-13, T-14, T-15 |
| T-19 | Auth: scaffold | Java Dev A | Apr 26 | 3h | T-01 |
| T-20 | Auth: register endpoint | Java Dev A | Apr 27 | 4h | T-19 |
| T-21 | Auth: login + JWT | Java Dev A | Apr 27 | 4h | T-19, T-20 |
| T-22 | Auth: token refresh | Java Dev A | Apr 28 | 3h | T-21 |
| T-23 | Auth: logout | Java Dev A | Apr 28 | 2h | T-21 |
| T-24 | Auth: get profile | Java Dev A | Apr 28 | 2h | T-21 |
| T-25 | Auth: tests | Java Dev A | May 1 | 4h | T-20–T-24 |
| T-26 | Chat: scaffold | Rust Dev | Apr 26 | 4h | T-01 |
| T-27 | Chat: send message | Rust Dev | Apr 27 | 5h | T-05, T-26, T-40 |
| T-28 | Chat: get messages | Rust Dev | Apr 28 | 4h | T-26, T-27 |
| T-29 | Chat: delete message | Rust Dev | Apr 28 | 3h | T-26, T-27 |
| T-30 | Chat: file attachments | Rust Dev | Apr 29 | 5h | T-26, T-07 |
| T-31 | Chat: mention Kafka events | Rust Dev | Apr 29 | 3h | T-26, T-03, T-06 |
| T-32 | Chat: WebSocket push | Rust Dev | Apr 30 | 4h | T-26, T-27, T-48 |
| T-33 | Chat: tests | Rust Dev | May 1 | 4h | T-27–T-31 |
| T-34 | Servers: scaffold | Java Dev B | Apr 26 | 3h | T-01 |
| T-35 | Servers: server CRUD | Java Dev B | Apr 27 | 4h | T-34 |
| T-36 | Servers: channel CRUD | Java Dev B | Apr 28 | 4h | T-34, T-35 |
| T-37 | Servers: membership | Java Dev B | Apr 28 | 3h | T-34, T-35 |
| T-38 | Servers: roles + permissions | Java Dev B | Apr 29 | 5h | T-34, T-35, T-37 |
| T-39 | Servers: Kafka consumer | Java Dev B | Apr 29 | 2h | T-03, T-34, T-06 |
| T-40 | Servers: CheckPerm gRPC | Java Dev B | Apr 30 | 5h | T-02, T-34, T-38 |
| T-41-s | Servers: tests | Java Dev B | May 1 | 4h | T-35–T-40 |
| T-41 | Voice: scaffold | Python Dev | Apr 26 | 3h | T-01 |
| T-42 | Voice: join channel | Python Dev | Apr 27 | 4h | T-05, T-41, T-40 |
| T-43 | Voice: leave channel | Python Dev | Apr 27 | 2h | T-41, T-42 |
| T-44 | Voice: list participants | Python Dev | Apr 28 | 2h | T-41, T-42 |
| T-45 | Voice: WebRTC signaling | Python Dev | Apr 29 | 6h | T-41, T-42, T-14 |
| T-46 | Voice: WS participant events | Python Dev | Apr 30 | 3h | T-41–T-45 |
| T-47 | Voice: tests | Python Dev | May 1 | 3h | T-42–T-45 |
| T-48 | Presence: scaffold | Go Dev | Apr 26 | 3h | T-01 |
| T-49 | Presence: register session | Go Dev | Apr 27 | 3h | T-48 |
| T-50 | Presence: deregister session | Go Dev | Apr 27 | 2h | T-48, T-49 |
| T-51 | Presence: heartbeat | Go Dev | Apr 28 | 2h | T-48, T-49 |
| T-52 | Presence: query by channel | Go Dev | Apr 28 | 3h | T-48, T-49 |
| T-53 | Presence: query by user | Go Dev | Apr 29 | 2h | T-48, T-49 |
| T-54 | Presence: tests | Go Dev | May 1 | 3h | T-49–T-53 |
| T-55 | Tips: scaffold | Python Dev | Apr 26 | 2h | T-01 |
| T-56 | Tips: send tip | Python Dev | Apr 28 | 4h | T-55 |
| T-57 | Tips: list tips | Python Dev | Apr 29 | 3h | T-55, T-56 |
| T-58 | Tips: tests | Python Dev | May 1 | 2h | T-56, T-57 |
| T-59 | Web App: scaffold + routing | JS Dev | Apr 26 | 3h | T-01, T-04 |
| T-60 | Web App: auth flows | JS Dev | Apr 27 | 4h | T-59, T-20, T-21 |
| T-61 | Web App: server list sidebar | JS Dev | Apr 27 | 3h | T-59, T-35 |
| T-62 | Web App: channel list | JS Dev | Apr 28 | 3h | T-59, T-36 |
| T-63 | Web App: message list | JS Dev | Apr 28 | 4h | T-59, T-28 |
| T-64 | Web App: send + real-time | JS Dev | Apr 29 | 5h | T-59, T-27, T-14, T-32 |
| T-65 | Web App: voice UI | JS Dev | Apr 30 | 5h | T-59, T-42–T-45 |
| T-66 | Web App: tips UI | JS Dev | Apr 30 | 3h | T-59, T-56, T-57 |
| T-67 | Web App: tests | JS Dev | May 1 | 4h | T-60–T-64 |
| T-68 | Desktop: static export | JS Dev | Apr 28 | 2h | T-59 |
| T-69 | Desktop: Electron scaffold | JS Dev | Apr 28 | 3h | T-01 |
| T-70 | Desktop: API URL config | JS Dev | Apr 29 | 2h | T-68, T-69 |
| T-71 | Desktop: system tray | JS Dev | Apr 30 | 3h | T-69 |
| T-72 | Desktop: native notifications | JS Dev | Apr 30 | 3h | T-69, T-14 |
| T-73 | Desktop: package + build | JS Dev | May 1 | 2h | T-68–T-71 |
| T-74 | Integration: smoke test | Tech Lead | May 1 | 3h | T-08, T-21, T-27, T-40, T-42 |
| T-75 | Integration: Kafka flows | Tech Lead | May 1 | 2h | T-20, T-27, T-31, T-39 |
| T-76 | Integration: gRPC CheckPerm | Tech Lead | May 1 | 2h | T-40, T-27, T-42 |
| T-77 | Integration: WebSocket delivery | Tech Lead | May 2 | 3h | T-14, T-32, T-52, T-64 |
| T-78 | Integration: Voice WebRTC | TL + Python | May 2 | 3h | T-42, T-45, T-65 |
| T-79 | Integration: Desktop E2E | JS Dev | May 2 | 3h | T-73, T-74 |
| T-80 | Integration: load test WS | Go Dev | May 2 | 3h | T-14, T-32, T-52 |
| T-81 | Docs: deployment guide | Tech Lead | May 3 | 3h | T-74–T-77 |

---

**Total tasks:** 82 | **Total estimated effort:** ~230h | **Deadline:** May 3, 2026
