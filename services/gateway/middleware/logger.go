package middleware

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"time"
)

type logFieldsKey struct{}

type logFields struct {
	UserID string
}

type logEntry struct {
	Timestamp  string `json:"timestamp"`
	Method     string `json:"method"`
	Path       string `json:"path"`
	StatusCode int    `json:"status_code"`
	LatencyMs  int64  `json:"latency_ms"`
	UserID     string `json:"user_id,omitempty"`
}

type statusResponseWriter struct {
	http.ResponseWriter
	code int
}

func (rw *statusResponseWriter) WriteHeader(code int) {
	rw.code = code
	rw.ResponseWriter.WriteHeader(code)
}

// Hijack delegates to the underlying ResponseWriter so that WebSocket upgrades
// (which require http.Hijacker) work through this wrapper.
func (rw *statusResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := rw.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("underlying ResponseWriter does not implement http.Hijacker")
	}
	return h.Hijack()
}

// Logger writes one JSON log line per request to stdout, skipping GET /health.
func Logger(next http.Handler) http.Handler {
	return NewLogger(os.Stdout)(next)
}

// NewLogger returns a logging middleware that writes to w. Intended for testing.
func NewLogger(w io.Writer) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodGet && r.URL.Path == "/health" {
				next.ServeHTTP(rw, r)
				return
			}

			fields := &logFields{}
			r = r.WithContext(context.WithValue(r.Context(), logFieldsKey{}, fields))

			srw := &statusResponseWriter{ResponseWriter: rw, code: http.StatusOK}
			start := time.Now()

			next.ServeHTTP(srw, r)

			b, _ := json.Marshal(logEntry{
				Timestamp:  start.UTC().Format(time.RFC3339Nano),
				Method:     r.Method,
				Path:       r.URL.Path,
				StatusCode: srw.code,
				LatencyMs:  time.Since(start).Milliseconds(),
				UserID:     fields.UserID,
			})
			b = append(b, '\n')
			w.Write(b) //nolint:errcheck
		})
	}
}
