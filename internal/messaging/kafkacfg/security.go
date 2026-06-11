// Package kafkacfg centralizes Kafka client security (SASL + TLS) so every
// producer and consumer authenticates consistently from one env-driven config.
//
// Auth is opt-in: with no env set, clients stay plaintext (local dev). In
// production set KAFKA_TLS_ENABLED=true and KAFKA_SASL_USERNAME/PASSWORD to get
// SASL_SSL (PLAIN over TLS) — the common managed-Kafka / Strimzi configuration.
// SASL/PLAIN uses only kafka-go's built-in mechanism (no extra dependency);
// SCRAM would require the xdg-go/scram module and can be added later.
package kafkacfg

import (
	"crypto/tls"
	"crypto/x509"
	"log"
	"os"
	"time"

	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl"
	"github.com/segmentio/kafka-go/sasl/plain"
)

// Security holds the resolved SASL mechanism and TLS config (either may be nil).
type Security struct {
	mechanism sasl.Mechanism
	tls       *tls.Config
}

// FromEnv builds Security from the environment.
//
//	KAFKA_TLS_ENABLED=true               -> enable TLS
//	KAFKA_TLS_CA_FILE=/path/ca.pem       -> custom CA bundle (optional)
//	KAFKA_TLS_INSECURE_SKIP_VERIFY=true  -> skip verification (dev only)
//	KAFKA_SASL_USERNAME / KAFKA_SASL_PASSWORD -> SASL/PLAIN credentials
func FromEnv() *Security {
	s := &Security{}

	if os.Getenv("KAFKA_TLS_ENABLED") == "true" {
		cfg := &tls.Config{MinVersion: tls.VersionTLS12}
		if caFile := os.Getenv("KAFKA_TLS_CA_FILE"); caFile != "" {
			if pem, err := os.ReadFile(caFile); err == nil {
				pool := x509.NewCertPool()
				if pool.AppendCertsFromPEM(pem) {
					cfg.RootCAs = pool
				} else {
					log.Printf("[KAFKA_TLS] failed to parse CA bundle at %s; using system roots", caFile)
				}
			} else {
				log.Printf("[KAFKA_TLS] cannot read CA file %s: %v; using system roots", caFile, err)
			}
		}
		if os.Getenv("KAFKA_TLS_INSECURE_SKIP_VERIFY") == "true" {
			cfg.InsecureSkipVerify = true
		}
		s.tls = cfg
	}

	if user, pass := os.Getenv("KAFKA_SASL_USERNAME"), os.Getenv("KAFKA_SASL_PASSWORD"); user != "" && pass != "" {
		s.mechanism = plain.Mechanism{Username: user, Password: pass}
	}

	return s
}

// Enabled reports whether any auth/transport security is configured.
func (s *Security) Enabled() bool { return s.mechanism != nil || s.tls != nil }

// Dialer returns a *kafka.Dialer for Readers (kafka.ReaderConfig.Dialer), with
// SASL/TLS applied. Always returns a usable dialer (plaintext when unconfigured).
func (s *Security) Dialer() *kafka.Dialer {
	return &kafka.Dialer{
		Timeout:       10 * time.Second,
		DualStack:     true,
		SASLMechanism: s.mechanism,
		TLS:           s.tls,
	}
}

// Transport returns a *kafka.Transport for Writers (Writer.Transport), with
// SASL/TLS applied, or nil when nothing is configured (so the writer keeps the
// kafka-go default transport in plaintext dev).
func (s *Security) Transport() *kafka.Transport {
	if !s.Enabled() {
		return nil
	}
	return &kafka.Transport{SASL: s.mechanism, TLS: s.tls}
}

// ApplyToWriter sets the secured transport on a writer when security is enabled.
func (s *Security) ApplyToWriter(w *kafka.Writer) {
	if w == nil {
		return
	}
	if t := s.Transport(); t != nil {
		w.Transport = t
	}
}
