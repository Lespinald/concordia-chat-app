# Auth Service Tasks Documentation

## Overview

The **Auth Service** is the microservice responsible for handling user identity, authentication, and session management within the application ecosystem (similar to Discord). It is built in **Java 21** using the **Spring Boot 3** framework.

This service is the only entity that interacts directly with the `auth_db` database in PostgreSQL. It handles credential validation, generates access and refresh tokens (JWT), applies password hashing to maintain security, and emits events via **Kafka** (such as `user-registered`) to notify other microservices about the creation of new users. All external communication and endpoint validation towards the end client are handled through the API Gateway, but the core identity business logic resides entirely here.

---

## Implemented Tasks

Below are the tasks that make up the complete development cycle of the Auth service, including their estimates, dependencies, and Definition of Done (DoD).

### 1. Initialize the Auth service as a Spring Boot application
**Assignee:** Java Dev A | **Estimate:** 3h | **Deps:** T-01

**Description:**
Initial setup of the microservice as a Spring Boot application with PostgreSQL connectivity and automated migrations.

**Definition of Done:**
- `services/auth/` has a working Maven/Gradle Spring Boot project.
- Reads `POSTGRES_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD` from environment.
- Flyway/Liquibase migrations run on startup, creating `users` table.
- `GET /health` returns `{"status":"ok"}` with HTTP 200.
- `./mvnw package -DskipTests` completes without errors.
- `services/auth/Dockerfile` builds and runs.

---

### 2. Implement POST /auth/register
**Assignee:** Java Dev A | **Estimate:** 4h | **Deps:** T-19

**Description:**
Implement the endpoint to create a new user, hash the password, and publish the `user-registered` Kafka event.

**Definition of Done:**
- `POST /auth/register` with `{"username":"alice","email":"alice@test.com","password":"secret123"}` → HTTP 201 `{"user_id":"<uuid>","username":"alice"}`.
- Password stored hashed (bcrypt, cost ≥ 12); plaintext never stored or logged.
- Duplicate email → HTTP 409 `{"error":"email already registered"}`.
- Duplicate username → HTTP 409 `{"error":"username already taken"}`.
- `user-registered` Kafka event published after successful registration.
- Verified: `docker exec kafka kafka-console-consumer.sh --topic user-registered --bootstrap-server localhost:9092 --from-beginning` shows event within 5 seconds.

---

### 3. Implement POST /auth/login
**Assignee:** Java Dev A | **Estimate:** 4h | **Deps:** T-19, T-20

**Description:**
Implement the login endpoint to verify credentials and issue an access token (15 min) and a refresh token (7 days).

**Definition of Done:**
- `POST /auth/login` with correct credentials → HTTP 200 `{"access_token":"<jwt>","refresh_token":"<uuid>","expires_in":900}`.
- Wrong password → HTTP 401 `{"error":"invalid credentials"}`.
- Unknown email → HTTP 401 with same error (no user enumeration).
- Access token is a signed JWT with claims: `sub` (user_id), `username`, `exp`, `iat`.
- Refresh token stored in PostgreSQL `refresh_tokens` table with `user_id`, `token_hash`, `expires_at`.
- Token passes validation by the shared auth middleware (T-05).

---

### 4. Implement POST /auth/refresh
**Assignee:** Java Dev A | **Estimate:** 3h | **Deps:** T-21

**Description:**
Implement the endpoint to exchange a valid refresh token for a new access token.

**Definition of Done:**
- `POST /auth/refresh` with `{"refresh_token":"<valid>"}` → HTTP 200 with new `access_token`.
- Expired refresh token → HTTP 401 `{"error":"refresh token expired"}`.
- Unknown or revoked token → HTTP 401.
- Old refresh token invalidated after use (rotation — one-time use).
- New access token accepted by shared auth middleware.

---

### 5. Implement DELETE /auth/logout
**Assignee:** Java Dev A | **Estimate:** 2h | **Deps:** T-21

**Description:**
Revoke the refresh token for the calling user, safely ending their session.

**Definition of Done:**
- `DELETE /auth/logout` with valid `Authorization: Bearer <token>` → HTTP 204.
- Refresh token associated with the user deleted from `refresh_tokens` table.
- Subsequent `POST /auth/refresh` with old token → HTTP 401.
- Unauthenticated call → HTTP 401.

---

### 6. Implement GET /auth/me
**Assignee:** Java Dev A | **Estimate:** 2h | **Deps:** T-21

**Description:**
Return the profile details of the authenticated user without exposing sensitive information.

**Definition of Done:**
- `GET /auth/me` with valid JWT → HTTP 200 `{"user_id":"<uuid>","username":"alice","email":"alice@test.com","created_at":"<iso8601>"}`.
- No sensitive fields exposed (no password hash, no refresh tokens).
- Unauthenticated call → HTTP 401.

---

### 7. Write tests for all Auth endpoints
**Assignee:** Java Dev A | **Estimate:** 4h | **Deps:** T-20, T-21, T-22, T-23, T-24

**Description:**
Create a robust test suite (unit and integration) for all endpoints using Testcontainers PostgreSQL and mocked components.

**Definition of Done:**
- `./mvnw test` passes with zero failures.
- Tests cover: registration (success, duplicate email, duplicate username), login (success, wrong password), refresh (success, expired, unknown), logout, profile fetch.
- Kafka publishing verified with a mocked producer (no real Kafka needed in unit tests).
- Test report generated at `target/surefire-reports/` or equivalent.
