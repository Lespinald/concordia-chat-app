package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/golang-jwt/jwt/v5"
)

const gwSecret = "gateway-test-secret-32-bytes!!"

// validToken returns a fresh JWT signed with gwSecret and sets JWT_SECRET for the test.
func validToken(t *testing.T) string {
	t.Helper()
	t.Setenv("JWT_SECRET", gwSecret)
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":      "u1",
		"username": "alice",
		"exp":      time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(gwSecret))
	if err != nil {
		t.Fatalf("validToken: %v", err)
	}
	return tok
}

// upstreamOf creates a mock server that records every request path it receives.
func upstreamOf(t *testing.T, status int) (*httptest.Server, <-chan string) {
	t.Helper()
	ch := make(chan string, 16)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ch <- r.URL.Path
		w.WriteHeader(status)
	}))
	t.Cleanup(srv.Close)
	return srv, ch
}

// graveyard returns a server URL that returns 418 so misdirected requests are obvious.
func graveyard(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func req(t *testing.T, gw *httptest.Server, method, path, token string) *http.Response {
	t.Helper()
	r, err := http.NewRequest(method, gw.URL+path, nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}

func assertStatus(t *testing.T, resp *http.Response, want int) {
	t.Helper()
	if resp.StatusCode != want {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected HTTP %d, got %d; body: %s", want, resp.StatusCode, body)
	}
}

// ── Auth routing ────────────────────────────────────────────────────────────

func TestAuthRoutingProtected(t *testing.T) {
	up, ch := upstreamOf(t, 200)
	tok := validToken(t)
	gw := httptest.NewServer(buildMux(config{
		AuthURL: up.URL, ServersURL: graveyard(t), ChatURL: graveyard(t),
		VoiceURL: graveyard(t), TipsURL: graveyard(t), PresenceURL: graveyard(t),
	}))
	t.Cleanup(gw.Close)

	resp := req(t, gw, "POST", "/auth/logout", tok)
	assertStatus(t, resp, 200)
	if got := <-ch; got != "/auth/logout" {
		t.Fatalf("upstream path = %q, want /auth/logout", got)
	}
}

func TestPublicAuthRoutes(t *testing.T) {
	up, ch := upstreamOf(t, 200)
	// No token — public routes must pass without Authorization header.
	_ = validToken(t) // still set JWT_SECRET so middleware initialises cleanly
	gw := httptest.NewServer(buildMux(config{
		AuthURL: up.URL, ServersURL: graveyard(t), ChatURL: graveyard(t),
		VoiceURL: graveyard(t), TipsURL: graveyard(t), PresenceURL: graveyard(t),
	}))
	t.Cleanup(gw.Close)

	for _, path := range []string{"/auth/register", "/auth/login", "/auth/refresh"} {
		resp := req(t, gw, "POST", path, "")
		assertStatus(t, resp, 200)
		<-ch
	}
}

// ── Servers routing ─────────────────────────────────────────────────────────

func TestServersRouting(t *testing.T) {
	up, ch := upstreamOf(t, 200)
	tok := validToken(t)
	gw := httptest.NewServer(buildMux(config{
		AuthURL: graveyard(t), ServersURL: up.URL, ChatURL: graveyard(t),
		VoiceURL: graveyard(t), TipsURL: graveyard(t), PresenceURL: graveyard(t),
	}))
	t.Cleanup(gw.Close)

	paths := []string{
		"/servers",
		"/servers/srv-1",
		"/servers/srv-1/members",
		"/servers/srv-1/channels",
		"/servers/srv-1/roles",
		"/channels/ch-1",            // bare channel metadata → Servers
		"/channels/ch-1/",           // trailing slash variant → Servers
	}
	for _, p := range paths {
		resp := req(t, gw, "GET", p, tok)
		assertStatus(t, resp, 200)
		<-ch
	}
}

// ── Chat routing ─────────────────────────────────────────────────────────────

func TestChatRouting(t *testing.T) {
	up, ch := upstreamOf(t, 200)
	tok := validToken(t)
	gw := httptest.NewServer(buildMux(config{
		AuthURL: graveyard(t), ServersURL: graveyard(t), ChatURL: up.URL,
		VoiceURL: graveyard(t), TipsURL: graveyard(t), PresenceURL: graveyard(t),
	}))
	t.Cleanup(gw.Close)

	paths := []string{
		"/channels/ch-1/messages",
		"/channels/ch-1/messages/msg-42",
		"/channels/ch-1/attachments/presign",
	}
	for _, p := range paths {
		resp := req(t, gw, "GET", p, tok)
		assertStatus(t, resp, 200)
		<-ch
	}
}

// ── Voice routing ────────────────────────────────────────────────────────────

func TestVoiceRouting(t *testing.T) {
	up, ch := upstreamOf(t, 200)
	tok := validToken(t)
	gw := httptest.NewServer(buildMux(config{
		AuthURL: graveyard(t), ServersURL: graveyard(t), ChatURL: graveyard(t),
		VoiceURL: up.URL, TipsURL: graveyard(t), PresenceURL: graveyard(t),
	}))
	t.Cleanup(gw.Close)

	resp := req(t, gw, "POST", "/voice/sessions", tok)
	assertStatus(t, resp, 200)
	if got := <-ch; got != "/voice/sessions" {
		t.Fatalf("upstream path = %q, want /voice/sessions", got)
	}
}

// ── Tips routing ─────────────────────────────────────────────────────────────

func TestTipsRouting(t *testing.T) {
	up, ch := upstreamOf(t, 200)
	tok := validToken(t)
	gw := httptest.NewServer(buildMux(config{
		AuthURL: graveyard(t), ServersURL: graveyard(t), ChatURL: graveyard(t),
		VoiceURL: graveyard(t), TipsURL: up.URL, PresenceURL: graveyard(t),
	}))
	t.Cleanup(gw.Close)

	for _, p := range []string{"/tips", "/tips/user-1"} {
		resp := req(t, gw, "GET", p, tok)
		assertStatus(t, resp, 200)
		<-ch
	}
}

// ── Unknown routes ───────────────────────────────────────────────────────────

func TestUnknownRoute404(t *testing.T) {
	tok := validToken(t)
	gw := httptest.NewServer(buildMux(config{
		AuthURL: graveyard(t), ServersURL: graveyard(t), ChatURL: graveyard(t),
		VoiceURL: graveyard(t), TipsURL: graveyard(t), PresenceURL: graveyard(t),
	}))
	t.Cleanup(gw.Close)

	resp := req(t, gw, "GET", "/nonexistent/path", tok)
	assertStatus(t, resp, 404)
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), `"not found"`) {
		t.Fatalf("unexpected 404 body: %s", body)
	}
}

// ── Upstream 5xx pass-through ────────────────────────────────────────────────

func TestUpstream5xxPassthrough(t *testing.T) {
	up, ch := upstreamOf(t, 503)
	tok := validToken(t)
	gw := httptest.NewServer(buildMux(config{
		AuthURL: graveyard(t), ServersURL: up.URL, ChatURL: graveyard(t),
		VoiceURL: graveyard(t), TipsURL: graveyard(t), PresenceURL: graveyard(t),
	}))
	t.Cleanup(gw.Close)

	resp := req(t, gw, "GET", "/servers/srv-1", tok)
	assertStatus(t, resp, 503)
	<-ch
}

// ── CORS integration tests ───────────────────────────────────────────────────

func corsGW(t *testing.T, origins []string) *httptest.Server {
	t.Helper()
	_ = validToken(t) // set JWT_SECRET
	cfg := config{
		AuthURL: graveyard(t), ServersURL: graveyard(t), ChatURL: graveyard(t),
		VoiceURL: graveyard(t), TipsURL: graveyard(t), PresenceURL: graveyard(t),
		AllowedOrigins: origins,
	}
	gw := httptest.NewServer(buildMux(cfg))
	t.Cleanup(gw.Close)
	return gw
}

func TestCORSPreflightReturns200(t *testing.T) {
	gw := corsGW(t, []string{"http://localhost:3000"})

	r, _ := http.NewRequest(http.MethodOptions, gw.URL+"/servers", nil)
	r.Header.Set("Origin", "http://localhost:3000")
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatalf("OPTIONS request: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("preflight status = %d, want 200", resp.StatusCode)
	}
	for _, hdr := range []struct{ key, want string }{
		{"Access-Control-Allow-Origin", "http://localhost:3000"},
		{"Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS"},
		{"Access-Control-Allow-Headers", "Content-Type, Authorization"},
	} {
		if got := resp.Header.Get(hdr.key); got != hdr.want {
			t.Errorf("%s = %q, want %q", hdr.key, got, hdr.want)
		}
	}
}

func TestCORSHeadersOnRegularRequest(t *testing.T) {
	gw := corsGW(t, []string{"http://localhost:3000"})
	tok := validToken(t)

	r, _ := http.NewRequest(http.MethodGet, gw.URL+"/health", nil)
	r.Header.Set("Origin", "http://localhost:3000")
	r.Header.Set("Authorization", "Bearer "+tok)
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Errorf("ACAO = %q, want http://localhost:3000", got)
	}
}

func TestCORSDisallowedOriginNoHeaders(t *testing.T) {
	gw := corsGW(t, []string{"http://localhost:3000"})

	r, _ := http.NewRequest(http.MethodOptions, gw.URL+"/health", nil)
	r.Header.Set("Origin", "http://evil.example.com")
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatalf("OPTIONS: %v", err)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("ACAO set for disallowed origin: %q", got)
	}
}

// ── getenv / parseOrigins / configFromEnv ───────────────────────────────────

func TestGetenv(t *testing.T) {
	t.Setenv("_TEST_GW_KEY", "")
	if got := getenv("_TEST_GW_KEY", "fallback"); got != "fallback" {
		t.Fatalf("unset key: got %q, want fallback", got)
	}
	t.Setenv("_TEST_GW_KEY", "explicit")
	if got := getenv("_TEST_GW_KEY", "fallback"); got != "explicit" {
		t.Fatalf("set key: got %q, want explicit", got)
	}
}

func TestParseOrigins(t *testing.T) {
	cases := []struct {
		raw  string
		want []string
	}{
		{"", []string{"http://localhost:3000"}},
		{"http://a.test", []string{"http://a.test"}},
		{"http://a.test,http://b.test", []string{"http://a.test", "http://b.test"}},
		{" http://a.test , http://b.test ", []string{"http://a.test", "http://b.test"}},
	}
	for _, tc := range cases {
		got := parseOrigins(tc.raw)
		if len(got) != len(tc.want) {
			t.Errorf("parseOrigins(%q) = %v, want %v", tc.raw, got, tc.want)
			continue
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Errorf("parseOrigins(%q)[%d] = %q, want %q", tc.raw, i, got[i], tc.want[i])
			}
		}
	}
}

func TestConfigFromEnv(t *testing.T) {
	t.Setenv("AUTH_URL", "http://auth-test:8181")
	t.Setenv("REDIS_ADDR", "redis-test:9999")
	t.Setenv("ALLOWED_ORIGINS", "http://frontend.test")

	cfg := configFromEnv()

	if cfg.AuthURL != "http://auth-test:8181" {
		t.Errorf("AuthURL = %q, want http://auth-test:8181", cfg.AuthURL)
	}
	if cfg.RedisAddr != "redis-test:9999" {
		t.Errorf("RedisAddr = %q, want redis-test:9999", cfg.RedisAddr)
	}
	if len(cfg.AllowedOrigins) != 1 || cfg.AllowedOrigins[0] != "http://frontend.test" {
		t.Errorf("AllowedOrigins = %v, want [http://frontend.test]", cfg.AllowedOrigins)
	}
}

// ── Integration: full request cycle ─────────────────────────────────────────

// TestIntegrationFullCycle exercises the complete middleware stack end-to-end:
// HTTP client → Logger → CORS → RequireAuth (JWT) → RateLimit (Redis) → proxy → mock upstream.
func TestIntegrationFullCycle(t *testing.T) {
	mr := miniredis.RunT(t)
	tok := validToken(t) // sets JWT_SECRET, user ID = "u1"

	up, ch := upstreamOf(t, http.StatusOK)
	gw := httptest.NewServer(buildMux(config{
		AuthURL:     graveyard(t),
		ServersURL:  up.URL,
		ChatURL:     graveyard(t),
		VoiceURL:    graveyard(t),
		TipsURL:     graveyard(t),
		PresenceURL: graveyard(t),
		RedisAddr:   mr.Addr(),
	}))
	t.Cleanup(gw.Close)

	resp := req(t, gw, "GET", "/servers/srv-1", tok)
	assertStatus(t, resp, http.StatusOK)

	if got := <-ch; got != "/servers/srv-1" {
		t.Fatalf("upstream received path %q, want /servers/srv-1", got)
	}
}

// TestIntegrationRateLimitEndToEnd verifies that the rate limiter inside the
// full gateway stack returns 429 once the per-user counter is exhausted.
func TestIntegrationRateLimitEndToEnd(t *testing.T) {
	mr := miniredis.RunT(t)
	tok := validToken(t) // user ID "u1"

	// Pre-fill the Redis counter so the next request tips over the 100-req limit.
	if err := mr.Set("ratelimit:u1", "100"); err != nil {
		t.Fatalf("miniredis Set: %v", err)
	}

	up, _ := upstreamOf(t, http.StatusOK)
	gw := httptest.NewServer(buildMux(config{
		AuthURL:     graveyard(t),
		ServersURL:  up.URL,
		ChatURL:     graveyard(t),
		VoiceURL:    graveyard(t),
		TipsURL:     graveyard(t),
		PresenceURL: graveyard(t),
		RedisAddr:   mr.Addr(),
	}))
	t.Cleanup(gw.Close)

	resp := req(t, gw, "GET", "/servers", tok)
	assertStatus(t, resp, http.StatusTooManyRequests)
}

// ── isChatPath unit tests ────────────────────────────────────────────────────

func TestIsChatPath(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"/channels/ch-1/messages", true},
		{"/channels/ch-1/messages/msg-1", true},
		{"/channels/ch-1/attachments/presign", true},
		{"/channels/ch-1", false},         // bare channel → Servers
		{"/channels/ch-1/", false},        // trailing slash → Servers
		{"/channels", false},              // root → Servers
		{"/servers/s/channels/ch-1", false}, // wrong prefix
	}
	for _, tc := range cases {
		if got := isChatPath(tc.path); got != tc.want {
			t.Errorf("isChatPath(%q) = %v, want %v", tc.path, got, tc.want)
		}
	}
}
