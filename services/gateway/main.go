package main

import (
	"log"
	"net/http"
	"os"
	_ "net/http/pprof" // registers /debug/pprof handlers on http.DefaultServeMux
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

	handler := buildMux(configFromEnv())

	if certFile != "" && keyFile != "" {
		log.Printf("gateway starting on :%s (HTTP) and :%s (HTTPS/TLS)", port, tlsPort)
		go func() { log.Fatal(http.ListenAndServe(":"+port, handler)) }()
		log.Fatal(http.ListenAndServeTLS(":"+tlsPort, certFile, keyFile, handler))
	} else {
		log.Printf("gateway starting on :%s", port)
		log.Fatal(http.ListenAndServe(":"+port, handler))
	}
}
