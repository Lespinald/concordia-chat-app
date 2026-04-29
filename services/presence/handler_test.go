package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// newTestHandler spins up an in-memory Redis and returns a handler wired to it.
func newTestHandler(t *testing.T) (*presenceHandler, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })
	return newHandler(rdb), mr
}

// do fires an HTTP request against handler h and returns the response.
func do(t *testing.T, h http.Handler, method, path string, body any) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body) //nolint:errcheck
	}
	r := httptest.NewRequest(method, path, &buf)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Result()
}

// buildMuxForTest wires up the full ServeMux used in production (sans Redis ping).
func buildMuxForTest(h *presenceHandler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /sessions", h.register)
	mux.HandleFunc("DELETE /sessions/{connID}", h.deregister)
	mux.HandleFunc("PUT /sessions/{connID}/heartbeat", h.heartbeat)
	mux.HandleFunc("GET /sessions", h.query)
	return mux
}

func decodeBody(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	return m
}

// ── Register ─────────────────────────────────────────────────────────────────

func TestRegisterSuccess(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := buildMuxForTest(h)

	resp := do(t, mux, http.MethodPost, "/sessions", map[string]any{
		"connection_id": "conn-1",
		"user_id":       "user-1",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d", resp.StatusCode)
	}
}

func TestRegisterDuplicate(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := buildMuxForTest(h)

	body := map[string]any{"connection_id": "conn-dup", "user_id": "user-1"}
	do(t, mux, http.MethodPost, "/sessions", body)

	resp := do(t, mux, http.MethodPost, "/sessions", body)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 Conflict on duplicate, got %d", resp.StatusCode)
	}
}

func TestRegisterMissingFields(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := buildMuxForTest(h)

	resp := do(t, mux, http.MethodPost, "/sessions", map[string]any{"user_id": "user-1"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request, got %d", resp.StatusCode)
	}
}

// ── Deregister ───────────────────────────────────────────────────────────────

func TestDeregisterSuccess(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := buildMuxForTest(h)

	do(t, mux, http.MethodPost, "/sessions", map[string]any{
		"connection_id": "conn-del",
		"user_id":       "user-1",
	})

	resp := do(t, mux, http.MethodDelete, "/sessions/conn-del", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on deregister, got %d", resp.StatusCode)
	}

	// Session should no longer exist — a heartbeat on it must return 404.
	hbResp := do(t, mux, http.MethodPut, "/sessions/conn-del/heartbeat", nil)
	if hbResp.StatusCode != http.StatusNotFound {
		t.Fatalf("session should be gone after deregister, got %d", hbResp.StatusCode)
	}
}

func TestDeregisterIdempotent(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := buildMuxForTest(h)

	// First call on a session that never existed.
	resp := do(t, mux, http.MethodDelete, "/sessions/nonexistent", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK (idempotent) on unknown session, got %d", resp.StatusCode)
	}

	// Register then deregister twice — second call must also succeed.
	do(t, mux, http.MethodPost, "/sessions", map[string]any{
		"connection_id": "conn-idem",
		"user_id":       "user-1",
	})
	do(t, mux, http.MethodDelete, "/sessions/conn-idem", nil)
	resp2 := do(t, mux, http.MethodDelete, "/sessions/conn-idem", nil)
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on second deregister, got %d", resp2.StatusCode)
	}
}

// ── Heartbeat ────────────────────────────────────────────────────────────────

func TestHeartbeatSuccess(t *testing.T) {
	h, mr := newTestHandler(t)
	mux := buildMuxForTest(h)

	do(t, mux, http.MethodPost, "/sessions", map[string]any{
		"connection_id": "conn-hb",
		"user_id":       "user-1",
	})

	// Fast-forward time so the key is near expiry.
	mr.FastForward(29 * time.Minute)

	resp := do(t, mux, http.MethodPut, "/sessions/conn-hb/heartbeat", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on heartbeat, got %d", resp.StatusCode)
	}

	// After the heartbeat the TTL should be reset to ~30 min; advancing another
	// 29 min should leave the key alive.
	mr.FastForward(29 * time.Minute)
	resp2 := do(t, mux, http.MethodPut, "/sessions/conn-hb/heartbeat", nil)
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("session should still be alive after heartbeat reset, got %d", resp2.StatusCode)
	}
}

func TestHeartbeatUnknownSession(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := buildMuxForTest(h)

	resp := do(t, mux, http.MethodPut, "/sessions/unknown-conn/heartbeat", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found for unknown session, got %d", resp.StatusCode)
	}
}

func TestHeartbeatResetsTTL(t *testing.T) {
	h, mr := newTestHandler(t)
	mux := buildMuxForTest(h)

	do(t, mux, http.MethodPost, "/sessions", map[string]any{
		"connection_id": "conn-ttl",
		"user_id":       "user-ttl",
	})

	// Advance 25 minutes (TTL was 30 min → 5 min remaining).
	mr.FastForward(25 * time.Minute)

	// Heartbeat resets TTL to 30 minutes.
	do(t, mux, http.MethodPut, "/sessions/conn-ttl/heartbeat", nil)

	// Advance another 29 minutes — session should still be alive.
	mr.FastForward(29 * time.Minute)
	resp := do(t, mux, http.MethodPut, "/sessions/conn-ttl/heartbeat", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected session alive after TTL reset, got %d", resp.StatusCode)
	}
}

// ── Query by channel ─────────────────────────────────────────────────────────

func TestQueryByChannelReturnsSubscribedSessions(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := buildMuxForTest(h)

	do(t, mux, http.MethodPost, "/sessions", map[string]any{
		"connection_id":       "conn-a",
		"user_id":             "user-1",
		"subscribed_channels": []string{"ch-x"},
	})
	do(t, mux, http.MethodPost, "/sessions", map[string]any{
		"connection_id":       "conn-b",
		"user_id":             "user-2",
		"subscribed_channels": []string{"ch-x", "ch-y"},
	})
	// conn-c is not in ch-x.
	do(t, mux, http.MethodPost, "/sessions", map[string]any{
		"connection_id":       "conn-c",
		"user_id":             "user-3",
		"subscribed_channels": []string{"ch-y"},
	})

	resp := do(t, mux, http.MethodGet, "/sessions?channel_id=ch-x", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", resp.StatusCode)
	}

	body := decodeBody(t, resp)
	rawSessions, ok := body["sessions"].([]any)
	if !ok {
		t.Fatalf("expected sessions array, got %T", body["sessions"])
	}
	if len(rawSessions) != 2 {
		t.Fatalf("expected 2 sessions for ch-x, got %d", len(rawSessions))
	}

	connIDs := map[string]bool{}
	for _, s := range rawSessions {
		m := s.(map[string]any)
		connIDs[m["connection_id"].(string)] = true
	}
	if !connIDs["conn-a"] || !connIDs["conn-b"] {
		t.Fatalf("expected conn-a and conn-b in result, got %v", connIDs)
	}
}

func TestQueryByChannelEmptyResult(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := buildMuxForTest(h)

	resp := do(t, mux, http.MethodGet, "/sessions?channel_id=ch-empty", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", resp.StatusCode)
	}
	body := decodeBody(t, resp)
	sessions, ok := body["sessions"].([]any)
	if !ok || len(sessions) != 0 {
		t.Fatalf("expected empty sessions array, got %v", body["sessions"])
	}
}

func TestQueryByChannelFiltersExpiredSessions(t *testing.T) {
	h, mr := newTestHandler(t)
	mux := buildMuxForTest(h)

	do(t, mux, http.MethodPost, "/sessions", map[string]any{
		"connection_id":       "conn-expire",
		"user_id":             "user-1",
		"subscribed_channels": []string{"ch-exp"},
	})

	// Expire the session by fast-forwarding past TTL.
	mr.FastForward(31 * time.Minute)

	resp := do(t, mux, http.MethodGet, "/sessions?channel_id=ch-exp", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", resp.StatusCode)
	}
	body := decodeBody(t, resp)
	sessions := body["sessions"].([]any)
	if len(sessions) != 0 {
		t.Fatalf("expected 0 sessions after TTL expiry, got %d", len(sessions))
	}
}

// ── Query by user ─────────────────────────────────────────────────────────────

func TestQueryByUserOnline(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := buildMuxForTest(h)

	do(t, mux, http.MethodPost, "/sessions", map[string]any{
		"connection_id": "conn-u1a",
		"user_id":       "user-online",
	})
	do(t, mux, http.MethodPost, "/sessions", map[string]any{
		"connection_id": "conn-u1b",
		"user_id":       "user-online",
	})

	resp := do(t, mux, http.MethodGet, "/sessions?user_id=user-online", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", resp.StatusCode)
	}
	body := decodeBody(t, resp)

	if body["user_id"] != "user-online" {
		t.Fatalf("user_id = %v, want user-online", body["user_id"])
	}
	if body["online"] != true {
		t.Fatalf("online = %v, want true", body["online"])
	}
	sessions := body["sessions"].([]any)
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}
}

func TestQueryByUserOffline(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := buildMuxForTest(h)

	resp := do(t, mux, http.MethodGet, "/sessions?user_id=user-offline", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", resp.StatusCode)
	}
	body := decodeBody(t, resp)

	if body["online"] != false {
		t.Fatalf("online = %v, want false for user with no sessions", body["online"])
	}
	sessions := body["sessions"].([]any)
	if len(sessions) != 0 {
		t.Fatalf("expected empty sessions for offline user, got %d", len(sessions))
	}
}

func TestQueryByUserAfterDeregister(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := buildMuxForTest(h)

	do(t, mux, http.MethodPost, "/sessions", map[string]any{
		"connection_id": "conn-gone",
		"user_id":       "user-transient",
	})
	do(t, mux, http.MethodDelete, "/sessions/conn-gone", nil)

	resp := do(t, mux, http.MethodGet, "/sessions?user_id=user-transient", nil)
	body := decodeBody(t, resp)

	if body["online"] != false {
		t.Fatalf("expected offline after deregister, got online=%v", body["online"])
	}
}

// ── Deregister removes channel index entries ──────────────────────────────────

func TestDeregisterCleansChannelIndex(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := buildMuxForTest(h)

	do(t, mux, http.MethodPost, "/sessions", map[string]any{
		"connection_id":       "conn-clean",
		"user_id":             "user-1",
		"subscribed_channels": []string{"ch-clean"},
	})
	do(t, mux, http.MethodDelete, "/sessions/conn-clean", nil)

	resp := do(t, mux, http.MethodGet, "/sessions?channel_id=ch-clean", nil)
	body := decodeBody(t, resp)
	sessions := body["sessions"].([]any)
	if len(sessions) != 0 {
		t.Fatalf("expected 0 sessions after deregister cleans index, got %d", len(sessions))
	}
}
