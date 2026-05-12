package ws

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"concordia/authmw"
	"concordia/gateway/middleware"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// Allow all origins in dev; restrict in prod via a proper CheckOrigin.
	CheckOrigin: func(_ *http.Request) bool { return true },
}

// connWriter serializes writes on a single websocket.Conn — Gorilla forbids
// concurrent calls to WriteMessage, and pushes from /internal/push race with
// the per-conn read loop's writes.
type connWriter struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (cw *connWriter) writeJSON(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	cw.mu.Lock()
	defer cw.mu.Unlock()
	return cw.conn.WriteMessage(websocket.TextMessage, b)
}

func (cw *connWriter) writeRaw(b []byte) error {
	cw.mu.Lock()
	defer cw.mu.Unlock()
	return cw.conn.WriteMessage(websocket.TextMessage, b)
}

// Handler handles WebSocket upgrades at GET /ws and fan-out pushes at
// POST /internal/push. Each accepted WS connection runs a single read-loop
// goroutine; the connWriter mutex makes WriteMessage safe to call from the
// push handler concurrently with read-loop writes.
type Handler struct {
	presenceURL string
	chatURL     string
	client      *http.Client

	active atomic.Int32 // tracks live connections; used for leak detection
	seq    atomic.Uint64

	mu    sync.RWMutex
	conns map[string]*connWriter
	subs  map[string]map[string]struct{} // connID -> channel set
}

// New returns a Handler that registers sessions with presenceURL and
// forwards message.send payloads to chatURL.
func New(presenceURL, chatURL string) *Handler {
	return &Handler{
		presenceURL: presenceURL,
		chatURL:     chatURL,
		client:      &http.Client{Timeout: 5 * time.Second},
		conns:       make(map[string]*connWriter),
		subs:        make(map[string]map[string]struct{}),
	}
}

// ActiveConns returns the number of currently open WebSocket connections.
// Used in load tests to verify goroutine cleanup.
func (h *Handler) ActiveConns() int32 { return h.active.Load() }

// --- wire types ---

type inMsg struct {
	Type      string          `json:"type"`
	ChannelID string          `json:"channel_id,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

type outMsg struct {
	Type  string `json:"type"`
	Error string `json:"error,omitempty"`
}

// --- ServeHTTP ---

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value(middleware.ClaimsKey).(*authmw.Claims)
	if !ok || claims == nil {
		// RequireAuth should have handled this already; guard against direct use.
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws: upgrade: %v", err)
		return
	}
	defer conn.Close()

	h.active.Add(1)
	defer h.active.Add(-1)

	connID := fmt.Sprintf("conn-%d", h.seq.Add(1))
	userID := claims.UserID
	cw := &connWriter{conn: conn}

	h.mu.Lock()
	h.conns[connID] = cw
	h.subs[connID] = make(map[string]struct{})
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.conns, connID)
		delete(h.subs, connID)
		h.mu.Unlock()
	}()

	// Register with Presence synchronously before sending the welcome.
	// Uses a background context so it outlives the HTTP request context.
	if err := h.registerSession(userID, connID, nil); err != nil {
		log.Printf("ws: register session %q: %v", connID, err)
		// Continue — presence being down should not block the connection.
	}
	// Deregistration runs in the same goroutine after the read loop exits.
	defer h.deregisterSession(connID)

	// Send a heartbeat to Presence every 2 minutes to reset the 30-minute TTL.
	hbCtx, hbCancel := context.WithCancel(context.Background())
	defer hbCancel()
	go h.runHeartbeats(hbCtx, connID)

	if err := cw.writeJSON(outMsg{Type: "connected"}); err != nil {
		return
	}

	conn.SetReadLimit(64 << 10) // 64 KiB per message
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return // normal close, network error, or read deadline
		}
		var in inMsg
		if err := json.Unmarshal(raw, &in); err != nil {
			_ = cw.writeJSON(outMsg{Type: "error", Error: "invalid json"})
			continue
		}
		h.dispatch(cw, userID, connID, &in)
	}
}

// --- message routing ---

func (h *Handler) dispatch(cw *connWriter, userID, connID string, in *inMsg) {
	switch in.Type {
	case "message.send":
		if in.ChannelID == "" {
			_ = cw.writeJSON(outMsg{Type: "error", Error: "channel_id required"})
			return
		}
		h.forwardToChat(cw, userID, in)
	case "channel.subscribe":
		if in.ChannelID == "" {
			_ = cw.writeJSON(outMsg{Type: "error", Error: "channel_id required"})
			return
		}
		h.updateSubscription(cw, userID, connID, in.ChannelID, true)
	case "channel.unsubscribe":
		if in.ChannelID == "" {
			_ = cw.writeJSON(outMsg{Type: "error", Error: "channel_id required"})
			return
		}
		h.updateSubscription(cw, userID, connID, in.ChannelID, false)
	default:
		_ = cw.writeJSON(outMsg{Type: "error", Error: "unknown type: " + in.Type})
	}
}

// updateSubscription mutates the per-conn channel set and re-registers the
// session with Presence so its channel→sessions index reflects the new state.
// Presence's POST /sessions is idempotent for a given connection_id — it
// cleans the prior channel index entries before writing the new ones.
func (h *Handler) updateSubscription(cw *connWriter, userID, connID, channelID string, subscribe bool) {
	h.mu.Lock()
	set, ok := h.subs[connID]
	if !ok {
		// Connection was torn down concurrently; nothing to do.
		h.mu.Unlock()
		return
	}
	if subscribe {
		set[channelID] = struct{}{}
	} else {
		delete(set, channelID)
	}
	channels := make([]string, 0, len(set))
	for c := range set {
		channels = append(channels, c)
	}
	h.mu.Unlock()

	if err := h.registerSession(userID, connID, channels); err != nil {
		log.Printf("ws: re-register session %q: %v", connID, err)
		_ = cw.writeJSON(outMsg{Type: "error", Error: "subscribe failed"})
		return
	}
	ack := "channel.subscribed"
	if !subscribe {
		ack = "channel.unsubscribed"
	}
	_ = cw.writeJSON(map[string]string{"type": ack, "channel_id": channelID})
}

func (h *Handler) forwardToChat(cw *connWriter, userID string, in *inMsg) {
	endpoint := h.chatURL + "/channels/" + in.ChannelID + "/messages"
	body := in.Payload
	if len(body) == 0 {
		body = []byte("{}")
	}

	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		_ = cw.writeJSON(outMsg{Type: "error", Error: "internal error"})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", userID)

	resp, err := h.client.Do(req)
	if err != nil {
		_ = cw.writeJSON(outMsg{Type: "error", Error: "upstream unavailable"})
		return
	}
	resp.Body.Close()
	_ = cw.writeJSON(outMsg{Type: "message.ack"})
}

// --- presence calls ---

const heartbeatInterval = 2 * time.Minute

func (h *Handler) runHeartbeats(ctx context.Context, connID string) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			hbCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			req, _ := http.NewRequestWithContext(hbCtx, http.MethodPut,
				h.presenceURL+"/sessions/"+connID+"/heartbeat", nil)
			resp, err := h.client.Do(req)
			cancel()
			if err != nil {
				log.Printf("ws: heartbeat %q: %v", connID, err)
			} else {
				resp.Body.Close()
			}
		case <-ctx.Done():
			return
		}
	}
}

func (h *Handler) registerSession(userID, connID string, channels []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if channels == nil {
		channels = []string{}
	}
	body, _ := json.Marshal(map[string]any{
		"user_id":             userID,
		"connection_id":       connID,
		"subscribed_channels": channels,
	})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		h.presenceURL+"/sessions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := h.client.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func (h *Handler) deregisterSession(connID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodDelete,
		h.presenceURL+"/sessions/"+connID, nil)
	resp, err := h.client.Do(req)
	if err != nil {
		log.Printf("ws: deregister session %q: %v", connID, err)
		return
	}
	resp.Body.Close()
}

// --- internal push ---

// PushRequest is the body shape accepted by POST /internal/push.
type PushRequest struct {
	SessionIDs []string        `json:"session_ids"`
	Event      json.RawMessage `json:"event"`
}

// PushResponse reports the fan-out result.
type PushResponse struct {
	Delivered int `json:"delivered"`
	Missing   int `json:"missing"`
}

// PushHandler implements POST /internal/push. Internal-only path: in production
// this should be reachable only inside the Docker network or behind a shared
// secret — the route is not exposed via auth middleware on purpose.
func (h *Handler) PushHandler(w http.ResponseWriter, r *http.Request) {
	var req PushRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}
	if len(req.Event) == 0 {
		http.Error(w, `{"error":"event required"}`, http.StatusBadRequest)
		return
	}

	delivered := 0
	missing := 0
	for _, id := range req.SessionIDs {
		h.mu.RLock()
		cw, ok := h.conns[id]
		h.mu.RUnlock()
		if !ok {
			missing++
			continue
		}
		if err := cw.writeRaw(req.Event); err != nil {
			log.Printf("ws: push to %q failed: %v", id, err)
			missing++
			continue
		}
		delivered++
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(PushResponse{Delivered: delivered, Missing: missing})
}
