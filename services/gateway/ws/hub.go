package ws

import (
	"encoding/json"
	"sync"

	"github.com/gorilla/websocket"
)

// connWriter wraps a WebSocket connection with a mutex so both the Kafka
// broadcast goroutine and the per-connection read loop can write safely.
type connWriter struct {
	mu   sync.Mutex
	conn *websocket.Conn
}

func (w *connWriter) sendJSON(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return w.sendRaw(b)
}

func (w *connWriter) sendRaw(b []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.conn.WriteMessage(websocket.TextMessage, b)
}

// Hub tracks every live WebSocket connection so the Kafka consumer can
// broadcast new messages to all of them.
type Hub struct {
	mu      sync.RWMutex
	writers map[string]*connWriter
}

func NewHub() *Hub {
	return &Hub{writers: make(map[string]*connWriter)}
}

func (h *Hub) add(id string, w *connWriter) {
	h.mu.Lock()
	h.writers[id] = w
	h.mu.Unlock()
}

func (h *Hub) remove(id string) {
	h.mu.Lock()
	delete(h.writers, id)
	h.mu.Unlock()
}

// Broadcast sends b to every connected client; write errors per-client are ignored.
func (h *Hub) Broadcast(b []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, w := range h.writers {
		w.sendRaw(b) //nolint:errcheck
	}
}
