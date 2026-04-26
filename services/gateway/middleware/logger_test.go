package middleware_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"concordia/gateway/middleware"
)

func TestLoggerSkipsHealth(t *testing.T) {
	var buf bytes.Buffer
	h := middleware.NewLogger(&buf)(http.HandlerFunc(okHandler))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	h.ServeHTTP(rec, req)

	if buf.Len() != 0 {
		t.Fatalf("expected no log for GET /health, got %q", buf.String())
	}
}

func TestLoggerEmitsJSONFields(t *testing.T) {
	var buf bytes.Buffer
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
	})
	h := middleware.NewLogger(&buf)(handler)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/servers", nil)
	h.ServeHTTP(rec, req)

	var entry map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &entry); err != nil {
		t.Fatalf("log output is not valid JSON: %v\nraw: %s", err, buf.String())
	}

	checks := map[string]any{
		"method":      "POST",
		"path":        "/servers",
		"status_code": float64(http.StatusCreated),
	}
	for k, want := range checks {
		if got := entry[k]; got != want {
			t.Errorf("%s = %v, want %v", k, got, want)
		}
	}
	for _, required := range []string{"timestamp", "latency_ms"} {
		if _, ok := entry[required]; !ok {
			t.Errorf("log entry missing field %q", required)
		}
	}
	if _, ok := entry["user_id"]; ok {
		t.Error("user_id should be absent for unauthenticated request")
	}
}

func TestLoggerCapturesStatusCode(t *testing.T) {
	var buf bytes.Buffer
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})
	h := middleware.NewLogger(&buf)(handler)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/unknown", nil)
	h.ServeHTTP(rec, req)

	var entry map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &entry); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if got := entry["status_code"]; got != float64(http.StatusNotFound) {
		t.Errorf("status_code = %v, want 404", got)
	}
}

func TestLoggerRecordsUserID(t *testing.T) {
	t.Setenv("JWT_SECRET", testSecret)

	tok := makeToken(t, testSecret, time.Now().Add(time.Hour))

	var buf bytes.Buffer
	inner := http.HandlerFunc(okHandler)
	h := middleware.NewLogger(&buf)(middleware.RequireAuth(inner))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/servers", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rec, req)

	var entry map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &entry); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if got, ok := entry["user_id"]; !ok || got == "" {
		t.Errorf("expected user_id in log entry, got %v", got)
	}
}

func TestLoggerNoUserIDWhenUnauthenticated(t *testing.T) {
	t.Setenv("JWT_SECRET", testSecret)

	var buf bytes.Buffer
	// RequireAuth will reject the request (no token), but logger should still fire.
	h := middleware.NewLogger(&buf)(middleware.RequireAuth(http.HandlerFunc(okHandler)))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/servers", nil)
	h.ServeHTTP(rec, req)

	var entry map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &entry); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if _, ok := entry["user_id"]; ok {
		t.Error("user_id should be absent when request is rejected by auth")
	}
	if got := entry["status_code"]; got != float64(http.StatusUnauthorized) {
		t.Errorf("status_code = %v, want 401", got)
	}
}
