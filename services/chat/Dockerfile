FROM rust:1.82-alpine AS build
RUN apk add --no-cache musl-dev
WORKDIR /app
COPY . .
RUN cargo build --release

FROM alpine:3.20
COPY --from=build /app/target/release/chat-service /chat-service
ENTRYPOINT ["/chat-service"]
