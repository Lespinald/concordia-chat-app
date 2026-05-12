package main
 
import (
	"crypto/tls"
	"log"
	"net/http"
	"os"
	"time"
 
	_ "net/http/pprof" // registers /debug/pprof handlers on http.DefaultServeMux
)
 
func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
 
func main() {
	port := getenv("GATEWAY_PORT", "8443")
	certFile := getenv("TLS_CERT_FILE", "/certs/server.crt")
	keyFile := getenv("TLS_KEY_FILE", "/certs/server.key")
	tlsEnabled := getenv("TLS_ENABLED", "true") == "true"
 
	handler := buildMux(configFromEnv())
 
	srv := &http.Server{
		Addr:    ":" + port,
		Handler: handler,
 
		// Timeouts to mitigate slow-loris and resource exhaustion attacks.
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
 
		// Hardened TLS configuration: TLS 1.2+ only, modern cipher suites.
		TLSConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
			CurvePreferences: []tls.CurveID{
				tls.X25519,
				tls.CurveP256,
			},
			CipherSuites: []uint16{
				tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
				tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
				tls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305,
				tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305,
				tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
				tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
			},
		},
	}
 
	if tlsEnabled {
		log.Printf("gateway starting with TLS on :%s", port)
		log.Fatal(srv.ListenAndServeTLS(certFile, keyFile))
	} else {
		log.Printf("gateway starting WITHOUT TLS on :%s (dev mode)", port)
		log.Fatal(srv.ListenAndServe())
	}
}