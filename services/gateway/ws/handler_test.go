package ws_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"concordia/gateway/middleware"
	"concordia/gateway/ws"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
)

const testSecret = "ws-handler-test-secret-32bytes!!"

// makeToken sets JWT_SECRET and returns a signed token for user-1/alice.
func makeToken(t *testing.T) string {
	t.Helper()
	t.Setenv("JWT_SECRET", testSecret)
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":      "user-1",
		"username": "alice",
		"exp":      time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("makeToken: %v", err)
	}
	return tok
}

// --- presence mock ---

type presenceLog struct {
	mu          sync.Mutex
	registered  []map[string]any
	deregistered []string
}

func (pl *presenceLog) registerCount() int {
	pl.mu.Lock()
	defer pl.mu.Unlock()
	return len(pl.registered)
}

func (pl *presenceLog) deregisterCount() int {
	pl.mu.Lock()
	defer pl.mu.Unlock()
	return len(pl.deregistered)
}

func mockPresence(t *testing.T) (*httptest.Server, *presenceLog) {
	t.Helper()
	pl := &presenceLog{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/sessions":
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body) //nolint:errcheck
			pl.mu.Lock()
			pl.registered = append(pl.registered, body)
			pl.mu.Unlock()
			w.WriteHeader(http.StatusOK)

		case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/sessions/"):
			id := strings.TrimPrefix(r.URL.Path, "/sessions/")
			pl.mu.Lock()
			pl.deregistered = append(pl.deregistered, id)
			pl.mu.Unlock()
			w.WriteHeader(http.StatusOK)

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, pl
}

// --- test server & dial helpers ---

// newGateway wraps handler with RequireAuth and returns a test server + its ws:// base URL.
func newGateway(t *testing.T, h *ws.Handler) (*httptest.Server, string) {
	t.Helper()
	srv := httptest.NewServer(middleware.RequireAuth(h))
	t.Cleanup(srv.Close)
	return srv, "ws" + strings.TrimPrefix(srv.URL, "http")
}

// dial opens a WebSocket to baseURL + path. Returns (nil, resp) on handshake failure.
func dial(t *testing.T, baseURL, path, token string) (*websocket.Conn, *http.Response) {
	t.Helper()
	hdr := http.Header{}
	if token != "" {
		hdr.Set("Authorization", "Bearer "+token)
	}
	conn, resp, err := websocket.DefaultDialer.Dial(baseURL+path, hdr)
	if err != nil {
		return nil, resp
	}
	return conn, resp
}

// readMsg reads one JSON message with a 2-second deadline.
func readMsg(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal %q: %v", raw, err)
	}
	return m
}

// waitFor polls cond until true or deadline, failing the test on timeout.
func waitFor(t *testing.T, desc string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for: %s", desc)
}

// ── Tests ────────────────────────────────────────────────────────────────────

func TestWelcomeMessage(t *testing.T) {
	p, _ := mockPresence(t)
	tok := makeToken(t)

	_, wsBase := newGateway(t, ws.New(p.URL, "http://unused"))
	conn, _ := dial(t, wsBase, "/", tok)
	if conn == nil {
		t.Fatal("expected WebSocket connection, got handshake failure")
	}
	defer conn.Close()

	msg := readMsg(t, conn)
	if msg["type"] != "connected" {
		t.Fatalf(`expected {"type":"connected"}, got %v`, msg)
	}
}

func TestRejectsNoToken(t *testing.T) {
	_ = makeToken(t) // ensure JWT_SECRET is set
	p, _ := mockPresence(t)

	_, wsBase := newGateway(t, ws.New(p.URL, "http://unused"))
	conn, resp := dial(t, wsBase, "/", "")
	if conn != nil {
		conn.Close()
		t.Fatal("expected handshake rejection for missing token")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		t.Fatalf("expected 401 on missing token, got %d", status)
	}
}

func TestRejectsInvalidToken(t *testing.T) {
	_ = makeToken(t) // ensure JWT_SECRET is set
	p, _ := mockPresence(t)

	_, wsBase := newGateway(t, ws.New(p.URL, "http://unused"))
	conn, resp := dial(t, wsBase, "/", "definitely.not.valid")
	if conn != nil {
		conn.Close()
		t.Fatal("expected handshake rejection for invalid token")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 on invalid token, got %v", resp)
	}
}

func TestSessionRegisteredOnOpen(t *testing.T) {
	p, pl := mockPresence(t)
	tok := makeToken(t)

	_, wsBase := newGateway(t, ws.New(p.URL, "http://unused"))
	conn, _ := dial(t, wsBase, "/", tok)
	if conn == nil {
		t.Fatal("expected WebSocket connection")
	}
	defer conn.Close()

	// registerSession is called before the welcome message, so by the time
	// we receive it the POST /sessions is already complete.
	readMsg(t, conn) // welcome

	waitFor(t, "POST /sessions", func() bool { return pl.registerCount() > 0 })

	pl.mu.Lock()
	reg := pl.registered[0]
	pl.mu.Unlock()

	if reg["user_id"] != "user-1" {
		t.Fatalf("user_id = %q, want user-1", reg["user_id"])
	}
	if reg["connection_id"] == "" {
		t.Fatal("connection_id must not be empty")
	}
}

func TestSessionDeregisteredOnClose(t *testing.T) {
	p, pl := mockPresence(t)
	tok := makeToken(t)

	_, wsBase := newGateway(t, ws.New(p.URL, "http://unused"))
	conn, _ := dial(t, wsBase, "/", tok)
	if conn == nil {
		t.Fatal("expected WebSocket connection")
	}
	readMsg(t, conn) // welcome

	waitFor(t, "POST /sessions", func() bool { return pl.registerCount() > 0 })

	pl.mu.Lock()
	registeredID := pl.registered[0]["connection_id"]
	pl.mu.Unlock()

	conn.Close()

	waitFor(t, "DELETE /sessions/{id}", func() bool { return pl.deregisterCount() > 0 })

	pl.mu.Lock()
	deletedID := pl.deregistered[0]
	pl.mu.Unlock()

	if deletedID != registeredID {
		t.Fatalf("deregistered conn_id %q != registered conn_id %q", deletedID, registeredID)
	}
}

func TestMessageForwardedToChat(t *testing.T) {
	p, _ := mockPresence(t)
	tok := makeToken(t)

	type chatReq struct {
		path   string
		userID string
	}
	chatCh := make(chan chatReq, 4)
	chat := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		chatCh <- chatReq{path: r.URL.Path, userID: r.Header.Get("X-User-ID")}
		w.WriteHeader(http.StatusCreated)
	}))
	t.Cleanup(chat.Close)

	_, wsBase := newGateway(t, ws.New(p.URL, chat.URL))
	conn, _ := dial(t, wsBase, "/", tok)
	if conn == nil {
		t.Fatal("expected WebSocket connection")
	}
	defer conn.Close()
	readMsg(t, conn) // welcome

	raw, _ := json.Marshal(map[string]any{
		"type":       "message.send",
		"channel_id": "ch-xyz",
		"payload":    map[string]string{"content": "hello"},
	})
	if err := conn.WriteMessage(websocket.TextMessage, raw); err != nil {
		t.Fatalf("WriteMessage: %v", err)
	}

	ack := readMsg(t, conn)
	if ack["type"] != "message.ack" {
		t.Fatalf("expected message.ack, got %v", ack["type"])
	}

	select {
	case cr := <-chatCh:
		if cr.path != "/channels/ch-xyz/messages" {
			t.Fatalf("chat path = %q, want /channels/ch-xyz/messages", cr.path)
		}
		if cr.userID != "user-1" {
			t.Fatalf("X-User-ID = %q, want user-1", cr.userID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout: chat service never called")
	}
}

func TestUnknownMessageType(t *testing.T) {
	p, _ := mockPresence(t)
	tok := makeToken(t)

	_, wsBase := newGateway(t, ws.New(p.URL, "http://unused"))
	conn, _ := dial(t, wsBase, "/", tok)
	if conn == nil {
		t.Fatal("expected WebSocket connection")
	}
	defer conn.Close()
	readMsg(t, conn) // welcome

	raw, _ := json.Marshal(map[string]string{"type": "bogus.event"})
	conn.WriteMessage(websocket.TextMessage, raw) //nolint:errcheck

	resp := readMsg(t, conn)
	if resp["type"] != "error" {
		t.Fatalf("expected error response for unknown type, got %v", resp)
	}
}

// ── Branch-coverage tests ────────────────────────────────────────────────────

// TestServeHTTPNoClaims calls the handler directly without RequireAuth to
// exercise the guard clause that rejects requests with no JWT claims in context.
func TestServeHTTPNoClaims(t *testing.T) {
	_ = makeToken(t) // ensure JWT_SECRET is set
	h := ws.New("http://unused", "http://unused")

	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/ws", nil)
	h.ServeHTTP(rec, r) // no claims injected
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

// TestDispatchMissingChannelID sends a message.send frame that omits channel_id
// and expects an error reply containing "channel_id".
func TestDispatchMissingChannelID(t *testing.T) {
	p, _ := mockPresence(t)
	tok := makeToken(t)

	_, wsBase := newGateway(t, ws.New(p.URL, "http://unused"))
	conn, _ := dial(t, wsBase, "/", tok)
	if conn == nil {
		t.Fatal("expected WebSocket connection")
	}
	defer conn.Close()
	readMsg(t, conn) // discard welcome

	raw, _ := json.Marshal(map[string]any{
		"type":    "message.send",
		"payload": map[string]string{"content": "hello"},
		// channel_id intentionally omitted
	})
	conn.WriteMessage(websocket.TextMessage, raw) //nolint:errcheck

	resp := readMsg(t, conn)
	if resp["type"] != "error" {
		t.Fatalf("expected error frame, got type %q", resp["type"])
	}
	if errMsg, _ := resp["error"].(string); !strings.Contains(errMsg, "channel_id") {
		t.Fatalf("error %q should mention channel_id", errMsg)
	}
}

// TestForwardToChatUpstreamDown verifies that when the chat service is
// unreachable, the handler sends an "upstream unavailable" error frame rather
// than crashing or silently dropping the message.
func TestForwardToChatUpstreamDown(t *testing.T) {
	p, _ := mockPresence(t)
	tok := makeToken(t)

	// Port 19998 has nothing listening — connection will be refused immediately.
	_, wsBase := newGateway(t, ws.New(p.URL, "http://127.0.0.1:19998"))
	conn, _ := dial(t, wsBase, "/", tok)
	if conn == nil {
		t.Fatal("expected WebSocket connection")
	}
	defer conn.Close()
	readMsg(t, conn) // discard welcome

	raw, _ := json.Marshal(map[string]any{
		"type":       "message.send",
		"channel_id": "ch-1",
		"payload":    map[string]string{"content": "hi"},
	})
	conn.WriteMessage(websocket.TextMessage, raw) //nolint:errcheck

	resp := readMsg(t, conn)
	if resp["type"] != "error" {
		t.Fatalf("expected error frame when chat is down, got %v", resp)
	}
}

// ── Load test: 50 simultaneous connections ───────────────────────────────────

// newGatewayWithPush exposes both /ws (auth-protected) and /internal/push
// (no auth, internal-only) against the same Handler instance.
func newGatewayWithPush(t *testing.T, h *ws.Handler) (string, string) {
	t.Helper()
	mux := http.NewServeMux()
	mux.Handle("/", middleware.RequireAuth(h))
	mux.HandleFunc("POST /internal/push", h.PushHandler)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http"), srv.URL
}

func TestPushDeliversToConnectedSessions(t *testing.T) {
	p, _ := mockPresence(t)
	tok := makeToken(t)

	h := ws.New(p.URL, "http://unused")
	wsBase, httpBase := newGatewayWithPush(t, h)

	conn, _ := dial(t, wsBase, "/", tok)
	if conn == nil {
		t.Fatal("expected websocket connection")
	}
	defer conn.Close()
	_ = readMsg(t, conn) // drop welcome

	// Wait for the conn to be registered server-side.
	waitFor(t, "connection registered", func() bool { return h.ActiveConns() == 1 })

	// Discover the connection_id assigned by the gateway. The implementation
	// numbers them sequentially from 1, so the first conn is "conn-1".
	body := map[string]any{
		"session_ids": []string{"conn-1"},
		"event":       map[string]any{"type": "new_message", "payload": map[string]any{"content": "hi"}},
	}
	raw, _ := json.Marshal(body)
	resp, err := http.Post(httpBase+"/internal/push", "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("POST /internal/push: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("push status: %d", resp.StatusCode)
	}
	var out ws.PushResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.Delivered != 1 || out.Missing != 0 {
		t.Fatalf("expected delivered=1 missing=0, got %+v", out)
	}

	got := readMsg(t, conn)
	if got["type"] != "new_message" {
		t.Fatalf(`expected pushed event type="new_message", got %v`, got)
	}
}

func TestPushReportsMissingForUnknownSessions(t *testing.T) {
	p, _ := mockPresence(t)
	h := ws.New(p.URL, "http://unused")
	_, httpBase := newGatewayWithPush(t, h)

	body := map[string]any{
		"session_ids": []string{"conn-does-not-exist"},
		"event":       map[string]any{"type": "new_message"},
	}
	raw, _ := json.Marshal(body)
	resp, err := http.Post(httpBase+"/internal/push", "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("POST /internal/push: %v", err)
	}
	defer resp.Body.Close()
	var out ws.PushResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.Delivered != 0 || out.Missing != 1 {
		t.Fatalf("expected delivered=0 missing=1, got %+v", out)
	}
}

func TestPushRejectsInvalidJSON(t *testing.T) {
	p, _ := mockPresence(t)
	h := ws.New(p.URL, "http://unused")
	_, httpBase := newGatewayWithPush(t, h)

	resp, err := http.Post(httpBase+"/internal/push", "application/json", strings.NewReader("not-json"))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestLoad50SimultaneousConnections(t *testing.T) {
	p, _ := mockPresence(t)
	tok := makeToken(t)

	h := ws.New(p.URL, "http://unused")
	_, wsBase := newGateway(t, h)

	const n = 50
	conns := make([]*websocket.Conn, n)
	var wg sync.WaitGroup
	wg.Add(n)

	for i := range n {
		go func(i int) {
			defer wg.Done()
			conn, _ := dial(t, wsBase, "/", tok)
			if conn == nil {
				return
			}
			// Read welcome (with timeout so goroutine doesn't hang)
			conn.SetReadDeadline(time.Now().Add(3 * time.Second))
			if _, _, err := conn.ReadMessage(); err != nil {
				conn.Close()
				return
			}
			conn.SetReadDeadline(time.Time{})
			conns[i] = conn
		}(i)
	}
	wg.Wait()

	// All (or nearly all) connections should be established.
	if got := h.ActiveConns(); got < int32(n*4/5) {
		t.Fatalf("expected ≥%d active connections at peak, got %d", n*4/5, got)
	}

	// Close all connections from the client side.
	for _, c := range conns {
		if c != nil {
			c.Close()
		}
	}

	// Wait for server-side goroutines to finish (deregisterSession + loop exit).
	waitFor(t, "all connections closed", func() bool {
		return h.ActiveConns() == 0
	})

	if remaining := h.ActiveConns(); remaining != 0 {
		t.Fatalf("goroutine leak: %d server goroutines still active after all closes", remaining)
	}
}
