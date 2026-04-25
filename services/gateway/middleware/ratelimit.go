package middleware

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"concordia/authmw"

	"github.com/redis/go-redis/v9"
)

const (
	rateLimit  = 100
	rateWindow = time.Minute
)

// RateLimiter enforces a fixed-window rate limit of 100 req/min per user,
// backed by Redis counters keyed by user ID.
type RateLimiter struct {
	rdb *redis.Client
}

// NewRateLimiter creates a RateLimiter connected to the given Redis address.
func NewRateLimiter(addr string) *RateLimiter {
	return &RateLimiter{
		rdb: redis.NewClient(&redis.Options{Addr: addr}),
	}
}

// Limit is an http.Handler middleware that must be applied after RequireAuth
// so that JWT claims are present in the request context.
func (rl *RateLimiter) Limit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := r.Context().Value(ClaimsKey).(*authmw.Claims)
		if !ok || claims == nil {
			// No claims in context (shouldn't happen after RequireAuth) — pass through.
			next.ServeHTTP(w, r)
			return
		}

		key := fmt.Sprintf("ratelimit:%s", claims.UserID)
		ctx := r.Context()

		count, err := rl.rdb.Incr(ctx, key).Result()
		if err != nil {
			// Redis unavailable — fail open to avoid cascading outage.
			next.ServeHTTP(w, r)
			return
		}
		if count == 1 {
			rl.rdb.Expire(ctx, key, rateWindow) //nolint:errcheck
		}

		if count > rateLimit {
			ttl, _ := rl.rdb.TTL(ctx, key).Result()
			retryAfter := int(ttl.Seconds())
			if retryAfter <= 0 {
				retryAfter = int(rateWindow.Seconds())
			}
			writeTooManyRequests(w, retryAfter)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func writeTooManyRequests(w http.ResponseWriter, retryAfter int) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
	w.WriteHeader(http.StatusTooManyRequests)
	fmt.Fprint(w, `{"error":"rate limit exceeded"}`)
}
