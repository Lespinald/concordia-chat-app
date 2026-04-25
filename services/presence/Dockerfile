FROM golang:1.22-alpine AS build
WORKDIR /app
COPY . .
RUN CGO_ENABLED=0 go build -o /app/presence .

FROM alpine:3.20
COPY --from=build /app/presence /presence
ENTRYPOINT ["/presence"]
