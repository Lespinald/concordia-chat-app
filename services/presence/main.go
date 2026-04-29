package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

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

	// T-48: health check
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"status":"ok"}`)
	})

	// T-49: Registrar sesión WebSocket
	http.HandleFunc("/sessions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var body struct {
			SessionID string `json:"session_id"`
			UserID    string `json:"user_id"`
			ChannelID string `json:"channel_id"`
		}

		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}

		if body.SessionID == "" || body.UserID == "" {
			http.Error(w, "session_id and user_id are required", http.StatusBadRequest)
			return
		}

		ctx := context.Background()
		key := "session:" + body.SessionID

		err := rdb.HSet(ctx, key,
			"user_id", body.UserID,
			"channel_id", body.ChannelID,
		).Err()
		if err != nil {
			http.Error(w, "failed to register session", http.StatusInternalServerError)
			return
		}

		// La sesión expira en 24 horas si no se refresca
		rdb.Expire(ctx, key, 24*time.Hour)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		fmt.Fprintf(w, `{"session_id":"%s","status":"registered"}`, body.SessionID)
		log.Printf("presence: session registered session_id=%s user_id=%s", body.SessionID, body.UserID)
	})

	// T-50: Desregistrar sesión WebSocket
	http.HandleFunc("/sessions/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Extrae el sessionID de la URL: /sessions/{sessionID}
		sessionID := strings.TrimPrefix(r.URL.Path, "/sessions/")
		if sessionID == "" {
			http.Error(w, "session_id is required", http.StatusBadRequest)
			return
		}

		ctx := context.Background()
		key := "session:" + sessionID

		deleted, err := rdb.Del(ctx, key).Result()
		if err != nil {
			http.Error(w, "failed to deregister session", http.StatusInternalServerError)
			return
		}

		if deleted == 0 {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"session_id":"%s","status":"deregistered"}`, sessionID)
		log.Printf("presence: session deregistered session_id=%s", sessionID)
	})

	// T-52: Query sessions by channel
	http.HandleFunc("/sessions/by-channel", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		channelID := r.URL.Query().Get("channel_id")
		if channelID == "" {
			http.Error(w, "channel_id is required", http.StatusBadRequest)
			return
		}

		ctx := context.Background()

		// Busca todas las sesiones guardadas en Redis
		keys, err := rdb.Keys(ctx, "session:*").Result()
		if err != nil {
			http.Error(w, "failed to query sessions", http.StatusInternalServerError)
			return
		}

		type Session struct {
			SessionID string `json:"session_id"`
			UserID    string `json:"user_id"`
			ChannelID string `json:"channel_id"`
		}

		var sessions []Session

		for _, key := range keys {
			data, err := rdb.HGetAll(ctx, key).Result()
			if err != nil || data["channel_id"] != channelID {
				continue
			}
			sessionID := strings.TrimPrefix(key, "session:")
			sessions = append(sessions, Session{
				SessionID: sessionID,
				UserID:    data["user_id"],
				ChannelID: data["channel_id"],
			})
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sessions)
		log.Printf("presence: queried sessions for channel_id=%s count=%d", channelID, len(sessions))
	})

	log.Printf("presence: starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
