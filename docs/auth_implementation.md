# Implementation Documentation: Auth Microservice

This documentation details the implementation of tasks related to the Authentication microservice (`services/auth/`), confirming that **all listed tasks have been successfully completed** and explaining how they were resolved at the code and architecture level.

---

## 1. Initialize the Auth Service (Spring Boot + PostgreSQL)
**Status:** ✅ Completed
**Implementation Description:**
- The project was configured as a **Spring Boot application with Maven** (`pom.xml` includes dependencies for web, data-jpa, postgresql, flyway, kafka, and jwt).
- Database connectivity successfully reads from environment variables (`POSTGRES_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`) in `application.yml`.
- Initial database migrations were implemented using **Flyway** (`V1__create_users_table.sql` and `V2__create_refresh_tokens_table.sql`), which execute automatically upon server startup.
- The health check endpoint (`GET /health`) was implemented in `HealthController.java`, returning `{"status": "ok"}` with a 200 HTTP status.
- The `Dockerfile` was configured based on `eclipse-temurin:21` using a multi-stage build with Maven.

## 2. User Registration (`POST /auth/register`)
**Status:** ✅ Completed
**Implementation Description:**
- Implemented in `AuthController.register()` which in turn calls `AuthService.registerUser()`.
- Validates duplicate emails and usernames, throwing a `DuplicateResourceException` that the global exception handler intercepts to return an **HTTP 409 Conflict**.
- Passwords are protected using `BCryptPasswordEncoder` (Spring Security's default strength, $\ge$ 12) so plaintext is never stored or written to logs.
- After successfully persisting to PostgreSQL, a `user-registered` event is sent to **Kafka** via a `KafkaTemplate` provided by Spring Kafka, containing the user's id, username, and email.
- Returns **HTTP 201 Created** along with the `user_id` and `username`.

## 3. User Login (`POST /auth/login`)
**Status:** ✅ Completed
**Implementation Description:**
- Implemented in `AuthService.login()`.
- Compares the provided password with the database hash using `PasswordEncoder.matches()`. On failure, throws an `InvalidCredentialsException` resulting in an **HTTP 401 Unauthorized** with a generic message ("invalid credentials"), mitigating user enumeration risks.
- Generates and signs an **Access Token (JWT)** using the HS256 algorithm. The token expires in 15 minutes and includes the `user_id` (in the `sub` claim) and the `username`.
- Generates a **Refresh Token** (random UUID), which is hashed using SHA-256 before being stored in the `refresh_tokens` table to add an extra layer of security against potential database breaches.
- Returns **HTTP 200 OK** with both tokens.

## 4. Token Renewal (`POST /auth/refresh`)
**Status:** ✅ Completed
**Implementation Description:**
- Implemented in `AuthService.refresh()`.
- Hashes the provided `refresh_token` and searches for it in the database.
- Validates the expiration date (`expires_at`); if expired, the token is deleted, and **HTTP 401** is returned.
- If valid, **Refresh Token rotation (one-time use)** is enforced: The old token is immediately deleted from the `refresh_tokens` table, and a new token pair (Access and Refresh) is generated.

## 5. User Logout (`DELETE /auth/logout`)
**Status:** ✅ Completed
**Implementation Description:**
- Extracts the user ID directly from the JWT provided in the `Authorization: Bearer <token>` header.
- Deletes all refresh tokens associated with that `user_id` by invoking `refreshTokenRepository.deleteByUserId()`.
- Any future attempts to refresh the session or perform authenticated requests with that token will result in an **HTTP 401**, fully terminating the session. Returns **HTTP 204 No Content**.

## 6. User Profile (`GET /auth/me`)
**Status:** ✅ Completed
**Implementation Description:**
- Verifies authentication by manually intercepting and validating the JWT in the `Authorization` header.
- If valid, extracts the `user_id` and queries the database to build a `UserProfileResponse`.
- The returned payload completely omits sensitive information (no password hash, no exposed tokens), returning only the identifier, email, name, and creation date.

## 7. Test Suite and Coverage
**Status:** ✅ Completed
**Implementation Description:**
- Implemented in `AuthControllerTest.java` under the **Spring Boot Test** framework.
- Uses the **Testcontainers (`PostgreSQLContainer`)** library to spin up a reliable, ephemeral real database for each test suite execution cycle.
- Efficiently mocks Kafka using `@MockBean KafkaTemplate`, allowing verification of event emission (`Mockito.verify()`) without needing a real Kafka infrastructure running locally.
- **All test cases have been coded and pass successfully:** successful registrations, duplicate field validation, login attempts with incorrect credentials, successful/expired refresh token rotation, secure logout, and authenticated profile fetching.
- Tests can be automated directly with Maven (`./mvnw test`), generating Surefire Plugin compatible reports.
