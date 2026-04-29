package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/redis/go-redis/v9"
)

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	redisAddr := getenv("REDIS_ADDR", "localhost:6379")
	rdb := redis.NewClient(&redis.Options{Addr: redisAddr})
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		log.Fatalf("presence: cannot connect to Redis at %s: %v", redisAddr, err)
	}
	log.Printf("presence: connected to Redis at %s", redisAddr)

	port := getenv("PRESENCE_PORT", "8086")
	h := newHandler(rdb)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"status":"ok"}`)
	})
	mux.HandleFunc("POST /sessions", h.register)
	mux.HandleFunc("DELETE /sessions/{connID}", h.deregister)
	mux.HandleFunc("PUT /sessions/{connID}/heartbeat", h.heartbeat)
	mux.HandleFunc("GET /sessions", h.query)

	log.Printf("presence: starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
