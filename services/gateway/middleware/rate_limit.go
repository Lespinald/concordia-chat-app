package middleware

import (
	"net/http"
	"sync"
	"time"
)

type visitor struct {
	tokens float64
	last   time.Time
}

type RateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
	rate     float64
	burst    float64
}

// NewRateLimiter creates a new rate limiter that allows events up to rate per second and permits bursts of at most burst tokens.
func NewRateLimiter(rate float64, burst int) *RateLimiter {
	rl := &RateLimiter{
		visitors: make(map[string]*visitor),
		rate:     rate,
		burst:    float64(burst),
	}
	go rl.cleanup()
	return rl
}

func (rl *RateLimiter) cleanup() {
	for {
		time.Sleep(3 * time.Minute)
		rl.mu.Lock()
		for ip, v := range rl.visitors {
			if time.Since(v.last) > 5*time.Minute {
				delete(rl.visitors, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// Limit is a middleware that applies the rate limit to an http.Handler.
func (rl *RateLimiter) Limit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		// Basic naive IP extraction (in production use X-Forwarded-For if behind a LB)
		
		rl.mu.Lock()
		v, exists := rl.visitors[ip]
		if !exists {
			v = &visitor{tokens: rl.burst, last: time.Now()}
			rl.visitors[ip] = v
		}

		now := time.Now()
		elapsed := now.Sub(v.last).Seconds()
		v.tokens += elapsed * rl.rate
		if v.tokens > rl.burst {
			v.tokens = rl.burst
		}
		v.last = now

		if v.tokens >= 1.0 {
			v.tokens -= 1.0
			rl.mu.Unlock()
			next.ServeHTTP(w, r)
		} else {
			rl.mu.Unlock()
			http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
		}
	})
}
