package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRateLimiter(t *testing.T) {
	// Rate: 10 requests per second, Burst: 5 requests.
	rl := NewRateLimiter(10.0, 5)

	handler := rl.Limit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Make 5 requests, should all pass
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = "127.0.0.1:1234"
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)

		if w.Result().StatusCode != http.StatusOK {
			t.Fatalf("request %d expected status OK, got %d", i, w.Result().StatusCode)
		}
	}

	// 6th request should fail immediately
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusTooManyRequests {
		t.Fatalf("expected status TooManyRequests, got %d", w.Result().StatusCode)
	}

	// Wait to accumulate at least 1 token (0.1s * 10 = 1)
	time.Sleep(150 * time.Millisecond)

	req2 := httptest.NewRequest("GET", "/", nil)
	req2.RemoteAddr = "127.0.0.1:1234"
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)

	if w2.Result().StatusCode != http.StatusOK {
		t.Fatalf("expected status OK after wait, got %d", w2.Result().StatusCode)
	}
}

func TestRateLimiterDifferentIPs(t *testing.T) {
	rl := NewRateLimiter(10.0, 1)

	handler := rl.Limit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req1 := httptest.NewRequest("GET", "/", nil)
	req1.RemoteAddr = "10.0.0.1:1234"
	w1 := httptest.NewRecorder()
	handler.ServeHTTP(w1, req1)

	if w1.Result().StatusCode != http.StatusOK {
		t.Fatalf("req1 expected OK, got %d", w1.Result().StatusCode)
	}

	// Another IP should pass even if previous one exhausted its tokens
	req2 := httptest.NewRequest("GET", "/", nil)
	req2.RemoteAddr = "10.0.0.2:1234"
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)

	if w2.Result().StatusCode != http.StatusOK {
		t.Fatalf("req2 expected OK, got %d", w2.Result().StatusCode)
	}
}
