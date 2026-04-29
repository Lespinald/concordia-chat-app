package main

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

const sessionTTL = 30 * time.Minute

type presenceHandler struct {
	rdb *redis.Client
}

func newHandler(rdb *redis.Client) *presenceHandler {
	return &presenceHandler{rdb: rdb}
}

func sessionKey(connID string) string    { return "session:" + connID }
func userKey(userID string) string       { return "user:" + userID + ":sessions" }
func channelKey(chanID string) string    { return "channel:" + chanID + ":sessions" }

// POST /sessions
// Body: {"connection_id":"...","user_id":"...","subscribed_channels":["ch1",...]}
// Returns 201 Created or 409 if the connection_id is already registered.
func (h *presenceHandler) register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ConnectionID       string   `json:"connection_id"`
		UserID             string   `json:"user_id"`
		SubscribedChannels []string `json:"subscribed_channels"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ConnectionID == "" || body.UserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "connection_id and user_id required"})
		return
	}

	ctx := r.Context()
	key := sessionKey(body.ConnectionID)

	// HSetNX is atomic: returns false if the field already exists → 409 Conflict.
	set, err := h.rdb.HSetNX(ctx, key, "user_id", body.UserID).Result()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if !set {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "session already exists"})
		return
	}

	channelsJSON, _ := json.Marshal(body.SubscribedChannels)
	pipe := h.rdb.Pipeline()
	pipe.HSet(ctx, key, "subscribed_channels", string(channelsJSON))
	pipe.Expire(ctx, key, sessionTTL)
	pipe.SAdd(ctx, userKey(body.UserID), body.ConnectionID)
	for _, ch := range body.SubscribedChannels {
		pipe.SAdd(ctx, channelKey(ch), body.ConnectionID)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"status": "registered"})
}

// DELETE /sessions/{connID}
// Idempotent: always returns 200, even if the session does not exist.
func (h *presenceHandler) deregister(w http.ResponseWriter, r *http.Request) {
	connID := r.PathValue("connID")
	ctx := r.Context()
	key := sessionKey(connID)

	data, _ := h.rdb.HGetAll(ctx, key).Result()
	if len(data) > 0 {
		pipe := h.rdb.Pipeline()
		pipe.Del(ctx, key)
		pipe.SRem(ctx, userKey(data["user_id"]), connID)
		var channels []string
		json.Unmarshal([]byte(data["subscribed_channels"]), &channels) //nolint:errcheck
		for _, ch := range channels {
			pipe.SRem(ctx, channelKey(ch), connID)
		}
		pipe.Exec(ctx) //nolint:errcheck
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// PUT /sessions/{connID}/heartbeat
// Resets the session TTL to 30 minutes. Returns 404 if session does not exist.
func (h *presenceHandler) heartbeat(w http.ResponseWriter, r *http.Request) {
	connID := r.PathValue("connID")
	ctx := r.Context()
	key := sessionKey(connID)

	n, err := h.rdb.Exists(ctx, key).Result()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if n == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
		return
	}

	h.rdb.Expire(ctx, key, sessionTTL) //nolint:errcheck
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// GET /sessions?channel_id=... or GET /sessions?user_id=...
func (h *presenceHandler) query(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	switch {
	case q.Get("channel_id") != "":
		h.queryByChannel(w, r, q.Get("channel_id"))
	case q.Get("user_id") != "":
		h.queryByUser(w, r, q.Get("user_id"))
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "channel_id or user_id required"})
	}
}

type sessionEntry struct {
	ConnectionID string `json:"connection_id"`
	UserID       string `json:"user_id"`
}

// queryByChannel returns all sessions subscribed to the given channel.
// Uses a secondary index (channel:{id}:sessions set) for O(1) lookup,
// then pipelines HGetAll to filter out TTL-expired stale entries.
func (h *presenceHandler) queryByChannel(w http.ResponseWriter, r *http.Request, channelID string) {
	ctx := r.Context()

	connIDs, err := h.rdb.SMembers(ctx, channelKey(channelID)).Result()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	sessions := make([]sessionEntry, 0)
	if len(connIDs) > 0 {
		pipe := h.rdb.Pipeline()
		cmds := make([]*redis.MapStringStringCmd, len(connIDs))
		for i, id := range connIDs {
			cmds[i] = pipe.HGetAll(ctx, sessionKey(id))
		}
		pipe.Exec(ctx) //nolint:errcheck

		for i, cmd := range cmds {
			data, err := cmd.Result()
			if err != nil || len(data) == 0 {
				continue // TTL-expired or missing
			}
			sessions = append(sessions, sessionEntry{
				ConnectionID: connIDs[i],
				UserID:       data["user_id"],
			})
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
}

type userSessionEntry struct {
	ConnectionID string `json:"connection_id"`
}

// queryByUser returns the online status and all active sessions for a user.
func (h *presenceHandler) queryByUser(w http.ResponseWriter, r *http.Request, userID string) {
	ctx := r.Context()

	connIDs, err := h.rdb.SMembers(ctx, userKey(userID)).Result()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	sessions := make([]userSessionEntry, 0)
	if len(connIDs) > 0 {
		pipe := h.rdb.Pipeline()
		cmds := make([]*redis.IntCmd, len(connIDs))
		for i, id := range connIDs {
			cmds[i] = pipe.Exists(ctx, sessionKey(id))
		}
		pipe.Exec(ctx) //nolint:errcheck

		for i, cmd := range cmds {
			if n, err := cmd.Result(); err == nil && n > 0 {
				sessions = append(sessions, userSessionEntry{ConnectionID: connIDs[i]})
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"user_id":  userID,
		"online":   len(sessions) > 0,
		"sessions": sessions,
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}
