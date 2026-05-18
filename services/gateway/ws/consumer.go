package ws

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/segmentio/kafka-go"
)

// StartConsumer reads from the message-created Kafka topic and broadcasts each
// event wrapped as {"type":"new_message","payload":<kafka-value>} to all
// connected WebSocket clients. The frontend filters by channel_id client-side.
func StartConsumer(ctx context.Context, brokers []string, hub *Hub) {
	r := kafka.NewReader(kafka.ReaderConfig{
		Brokers: brokers,
		Topic:   "message-created",
		// No GroupID: skip consumer-group coordination (join/sync/heartbeat/commit).
		// WebSocket delivery is best-effort — on gateway restart we read from the
		// end of the topic and skip already-published messages.
		StartOffset: kafka.LastOffset,
		MinBytes:    1,
		MaxBytes:    1 << 20, // 1 MiB
		MaxWait:     500 * time.Millisecond,
	})
	defer r.Close()

	type wsEnvelope struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}

	for {
		m, err := r.ReadMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return // normal shutdown
			}
			log.Printf("ws: kafka consumer: %v", err)
			continue
		}

		out, err := json.Marshal(wsEnvelope{
			Type:    "new_message",
			Payload: json.RawMessage(m.Value),
		})
		if err != nil {
			continue
		}
		hub.Broadcast(out)
	}
}
