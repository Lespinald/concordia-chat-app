package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"

	"concordia/gateway/middleware"
	"concordia/gateway/ws"
)

type config struct {
	AuthURL        string
	ServersURL     string
	ChatURL        string
	VoiceURL       string
	TipsURL        string
	PresenceURL    string
	RedisAddr      string
	AllowedOrigins []string
}

func configFromEnv() config {
	return config{
		AuthURL:        getenv("AUTH_URL", "http://auth:8081"),
		ServersURL:     getenv("SERVERS_URL", "http://servers:8082"),
		ChatURL:        getenv("CHAT_URL", "http://chat:8083"),
		VoiceURL:       getenv("VOICE_URL", "http://voice:8084"),
		TipsURL:        getenv("TIPS_URL", "http://tips:8085"),
		PresenceURL:    getenv("PRESENCE_URL", "http://presence:8086"),
		RedisAddr:      getenv("REDIS_ADDR", "redis:6379"),
		AllowedOrigins: parseOrigins(os.Getenv("ALLOWED_ORIGINS")),
	}
}

func parseOrigins(raw string) []string {
	if raw == "" {
		return []string{
			"http://localhost:3000",
			"app://concordia",
			"http://localhost:8080",
		}
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if s := strings.TrimSpace(p); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func mustProxy(rawURL string) *httputil.ReverseProxy {
	u, err := url.Parse(rawURL)
	if err != nil {
		log.Fatalf("invalid upstream URL %q: %v", rawURL, err)
	}
	return httputil.NewSingleHostReverseProxy(u)
}

// isChatPath reports whether path should be routed to the Chat service.
// Only /channels/{id}/messages* and /channels/{id}/attachments* belong to Chat;
// bare /channels/{id} is channel metadata owned by the Servers service.
func isChatPath(path string) bool {
	rest := strings.TrimPrefix(path, "/channels/")
	if rest == path { // no "/channels/" prefix
		return false
	}
	slash := strings.Index(rest, "/")
	if slash < 0 {
		return false // /channels/{id} only — Servers
	}
	sub := rest[slash+1:]
	return strings.HasPrefix(sub, "messages") || strings.HasPrefix(sub, "attachments")
}

func buildMux(cfg config) http.Handler {
	authP     := mustProxy(cfg.AuthURL)
	serversP  := mustProxy(cfg.ServersURL)
	chatP     := mustProxy(cfg.ChatURL)
	voiceP    := mustProxy(cfg.VoiceURL)
	tipsP     := mustProxy(cfg.TipsURL)
	presenceP := mustProxy(cfg.PresenceURL)

	// router dispatches authenticated requests to the correct upstream.
	// isChatPath must be evaluated before the generic /channels prefix check.
	router := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		switch {
		case strings.HasPrefix(p, "/auth"):
			authP.ServeHTTP(w, r)
		case strings.HasPrefix(p, "/users"):
			authP.ServeHTTP(w, r)
		case isChatPath(p):
			chatP.ServeHTTP(w, r)
		case strings.HasPrefix(p, "/servers") || strings.HasPrefix(p, "/channels"):
			serversP.ServeHTTP(w, r)
		case strings.HasPrefix(p, "/voice"):
			voiceP.ServeHTTP(w, r)
		case strings.HasPrefix(p, "/tips"):
			tipsP.ServeHTTP(w, r)
		case strings.HasPrefix(p, "/presence"):
			presenceP.ServeHTTP(w, r)
		default:
			writeNotFound(w)
		}
	})

	rl := middleware.NewRateLimiter(cfg.RedisAddr)

	mux := http.NewServeMux()

	// Public routes — no JWT required.
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"status":"ok"}`)
	})
	mux.Handle("POST /auth/register", authP)
	mux.Handle("POST /auth/login", authP)
	mux.Handle("POST /auth/refresh", authP)

	// WebSocket upgrade — protected by JWT.
	wsH := ws.New(cfg.PresenceURL, cfg.ChatURL)
	mux.Handle("GET /ws", middleware.RequireAuth(wsH))

	// Internal fan-out endpoint called by Chat Svc to push events to specific
	// WebSocket sessions. Not auth-protected: relies on docker network isolation
	// (only Chat reaches it via the internal hostname). In production this
	// should be served on a separate internal port or guarded by a shared secret.
	mux.HandleFunc("POST /internal/push", wsH.PushHandler)

	// All other routes require a valid Bearer JWT and are rate-limited.
	// The catch-all "/" has lower priority than every explicit pattern above.
	mux.Handle("/", middleware.RequireAuth(rl.Limit(router)))

	// Pprof endpoints (dev only — exposes runtime internals).
	// The blank import of net/http/pprof in main.go registers handlers on
	// http.DefaultServeMux, which we proxy here.
	mux.Handle("/debug/pprof/", http.DefaultServeMux)

	return middleware.Logger(middleware.CORS(cfg.AllowedOrigins)(mux))
}

func writeNotFound(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotFound)
	json.NewEncoder(w).Encode(map[string]string{"error": "not found"}) //nolint:errcheck
}
