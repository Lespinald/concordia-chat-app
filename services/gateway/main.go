package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	_ "net/http/pprof" // registers /debug/pprof handlers on http.DefaultServeMux

	"concordia/gateway/ws"
)

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	port     := getenv("GATEWAY_PORT", "8080")
	tlsPort  := getenv("GATEWAY_TLS_PORT", "8443")
	certFile := getenv("TLS_CERT", "")
	keyFile  := getenv("TLS_KEY", "")

	cfg := configFromEnv()

	hub := ws.NewHub()
	brokers := strings.Split(cfg.KafkaBrokers, ",")
	go ws.StartConsumer(context.Background(), brokers, hub)

	handler := buildMux(cfg, hub)

	if certFile != "" && keyFile != "" {
		log.Printf("gateway starting on :%s (HTTP) and :%s (HTTPS/TLS)", port, tlsPort)
		go func() { log.Fatal(http.ListenAndServe(":"+port, handler)) }()
		log.Fatal(http.ListenAndServeTLS(":"+tlsPort, certFile, keyFile, handler))
	} else {
		log.Printf("gateway starting on :%s", port)
		log.Fatal(http.ListenAndServe(":"+port, handler))
	}
}
