package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"concordia/authmw"
	"concordia/gateway/middleware"

	"github.com/alicebob/miniredis/v2"
)

func newTestRateLimiter(t *testing.T) (*middleware.RateLimiter, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	rl := middleware.NewRateLimiter(mr.Addr())
	return rl, mr
}

func requestWithClaims(userID string) *http.Request {
	claims := &authmw.Claims{UserID: userID}
	ctx := context.WithValue(context.Background(), middleware.ClaimsKey, claims)
	return httptest.NewRequest(http.MethodGet, "/servers", nil).WithContext(ctx)
}

func TestUnderLimitAllowed(t *testing.T) {
	rl, _ := newTestRateLimiter(t)
	h := rl.Limit(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for i := 1; i <= 100; i++ {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, requestWithClaims("user-1"))
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i, rec.Code)
		}
	}
}

func TestOverLimitRejected(t *testing.T) {
	rl, _ := newTestRateLimiter(t)
	h := rl.Limit(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Burn through the 100-request budget.
	for i := 0; i < 100; i++ {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, requestWithClaims("user-2"))
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i+1, rec.Code)
		}
	}

	// 101st request must be rejected.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, requestWithClaims("user-2"))
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rec.Code)
	}
}

func TestRetryAfterHeader(t *testing.T) {
	rl, _ := newTestRateLimiter(t)
	h := rl.Limit(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for i := 0; i < 100; i++ {
		h.ServeHTTP(httptest.NewRecorder(), requestWithClaims("user-3"))
	}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, requestWithClaims("user-3"))

	retryAfter := rec.Header().Get("Retry-After")
	if retryAfter == "" {
		t.Fatal("expected Retry-After header, got none")
	}
	secs, err := strconv.Atoi(retryAfter)
	if err != nil || secs <= 0 {
		t.Fatalf("Retry-After %q is not a positive integer", retryAfter)
	}
}

func TestCounterResetAfterWindow(t *testing.T) {
	rl, mr := newTestRateLimiter(t)
	h := rl.Limit(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Use the full budget.
	for i := 0; i < 100; i++ {
		h.ServeHTTP(httptest.NewRecorder(), requestWithClaims("user-4"))
	}

	// Fast-forward past the window so the key expires.
	mr.FastForward(time.Minute + time.Second)

	// After expiry a fresh window begins — the request should succeed.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, requestWithClaims("user-4"))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 after window reset, got %d", rec.Code)
	}
}

func TestNoClaimsPassesThrough(t *testing.T) {
	rl, _ := newTestRateLimiter(t)
	h := rl.Limit(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Request with no claims in context should be passed through.
	req := httptest.NewRequest(http.MethodGet, "/servers", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestUsersHaveIndependentCounters(t *testing.T) {
	rl, _ := newTestRateLimiter(t)
	h := rl.Limit(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Exhaust user-5's budget.
	for i := 0; i < 100; i++ {
		h.ServeHTTP(httptest.NewRecorder(), requestWithClaims("user-5"))
	}
	rec5 := httptest.NewRecorder()
	h.ServeHTTP(rec5, requestWithClaims("user-5"))
	if rec5.Code != http.StatusTooManyRequests {
		t.Fatalf("user-5: expected 429, got %d", rec5.Code)
	}

	// user-6 has its own counter and should still be allowed.
	rec6 := httptest.NewRecorder()
	h.ServeHTTP(rec6, requestWithClaims("user-6"))
	if rec6.Code != http.StatusOK {
		t.Fatalf("user-6: expected 200, got %d", rec6.Code)
	}
}

func TestRedisUnavailableFailsOpen(t *testing.T) {
	// Point at a port with nothing listening.
	rl := middleware.NewRateLimiter("127.0.0.1:19999")
	h := rl.Limit(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, requestWithClaims("user-7"))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected fail-open 200, got %d", rec.Code)
	}
}

