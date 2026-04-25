package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCORSPreflight(t *testing.T) {
	h := CORS([]string{"http://localhost:3000"})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called for OPTIONS preflight")
	}))

	r := httptest.NewRequest(http.MethodOptions, "/any", nil)
	r.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("preflight status = %d, want 200", w.Code)
	}
	assertHeader(t, w, "Access-Control-Allow-Origin", "http://localhost:3000")
	assertHeader(t, w, "Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	assertHeader(t, w, "Access-Control-Allow-Headers", "Content-Type, Authorization")
}

func TestCORSAllowedOriginPassThrough(t *testing.T) {
	called := false
	h := CORS([]string{"http://localhost:3000"})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))

	r := httptest.NewRequest(http.MethodGet, "/health", nil)
	r.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if !called {
		t.Fatal("next handler was not called")
	}
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", w.Code)
	}
	assertHeader(t, w, "Access-Control-Allow-Origin", "http://localhost:3000")
}

func TestCORSDisallowedOrigin(t *testing.T) {
	h := CORS([]string{"http://localhost:3000"})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	r := httptest.NewRequest(http.MethodGet, "/health", nil)
	r.Header.Set("Origin", "http://evil.example.com")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("ACAO header set for disallowed origin: %q", got)
	}
}

func TestCORSPreflightDisallowedOrigin(t *testing.T) {
	h := CORS([]string{"http://localhost:3000"})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	r := httptest.NewRequest(http.MethodOptions, "/any", nil)
	r.Header.Set("Origin", "http://evil.example.com")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	// Still short-circuits with 200 but without CORS headers.
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("ACAO header set for disallowed origin: %q", got)
	}
}

func TestCORSMultipleOrigins(t *testing.T) {
	h := CORS([]string{"http://localhost:3000", "https://app.example.com"})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }),
	)

	for _, origin := range []string{"http://localhost:3000", "https://app.example.com"} {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		assertHeader(t, w, "Access-Control-Allow-Origin", origin)
	}
}

func assertHeader(t *testing.T, w *httptest.ResponseRecorder, key, want string) {
	t.Helper()
	if got := w.Header().Get(key); got != want {
		t.Errorf("header %q = %q, want %q", key, got, want)
	}
}
