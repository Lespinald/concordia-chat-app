package ws

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
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

// Handler handles WebSocket upgrades at GET /ws.
// Each accepted connection runs a single read-loop goroutine; all writes
// happen on that same goroutine so no mutex is needed on the conn.
type Handler struct {
	presenceURL string
	chatURL     string
	client      *http.Client

	active atomic.Int32 // tracks live connections; used for leak detection
	seq    atomic.Uint64
}

// New returns a Handler that registers sessions with presenceURL and
// forwards message.send payloads to chatURL.
func New(presenceURL, chatURL string) *Handler {
	return &Handler{
		presenceURL: presenceURL,
		chatURL:     chatURL,
		client:      &http.Client{Timeout: 5 * time.Second},
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

	// Register with Presence synchronously before sending the welcome.
	// Uses a background context so it outlives the HTTP request context.
	if err := h.registerSession(userID, connID); err != nil {
		log.Printf("ws: register session %q: %v", connID, err)
		// Continue — presence being down should not block the connection.
	}
	// Deregistration runs in the same goroutine after the read loop exits.
	defer h.deregisterSession(connID)

	// Send a heartbeat to Presence every 2 minutes to reset the 30-minute TTL.
	hbCtx, hbCancel := context.WithCancel(context.Background())
	defer hbCancel()
	go h.runHeartbeats(hbCtx, connID)

	if err := writeJSON(conn, outMsg{Type: "connected"}); err != nil {
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
			_ = writeJSON(conn, outMsg{Type: "error", Error: "invalid json"})
			continue
		}
		h.dispatch(conn, userID, &in)
	}
}

// --- message routing ---

func (h *Handler) dispatch(conn *websocket.Conn, userID string, in *inMsg) {
	switch in.Type {
	case "message.send":
		if in.ChannelID == "" {
			_ = writeJSON(conn, outMsg{Type: "error", Error: "channel_id required"})
			return
		}
		h.forwardToChat(conn, userID, in)
	default:
		_ = writeJSON(conn, outMsg{Type: "error", Error: "unknown type: " + in.Type})
	}
}

func (h *Handler) forwardToChat(conn *websocket.Conn, userID string, in *inMsg) {
	endpoint := h.chatURL + "/channels/" + in.ChannelID + "/messages"
	body := in.Payload
	if len(body) == 0 {
		body = []byte("{}")
	}

	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		_ = writeJSON(conn, outMsg{Type: "error", Error: "internal error"})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", userID)

	resp, err := h.client.Do(req)
	if err != nil {
		_ = writeJSON(conn, outMsg{Type: "error", Error: "upstream unavailable"})
		return
	}
	resp.Body.Close()
	_ = writeJSON(conn, outMsg{Type: "message.ack"})
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

func (h *Handler) registerSession(userID, connID string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	body, _ := json.Marshal(map[string]string{"user_id": userID, "connection_id": connID})
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

// --- helpers ---

func writeJSON(conn *websocket.Conn, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return conn.WriteMessage(websocket.TextMessage, b)
}
