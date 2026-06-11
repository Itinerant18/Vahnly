package kafkacfg

import "testing"

func TestFromEnv_PlaintextWhenUnset(t *testing.T) {
	// Ensure a clean env for this case.
	for _, k := range []string{"KAFKA_TLS_ENABLED", "KAFKA_SASL_USERNAME", "KAFKA_SASL_PASSWORD"} {
		t.Setenv(k, "")
	}
	s := FromEnv()
	if s.Enabled() {
		t.Error("expected disabled (plaintext) when no env set")
	}
	if s.Dialer() == nil {
		t.Error("Dialer must always be non-nil (plaintext dialer in dev)")
	}
	if s.Transport() != nil {
		t.Error("Transport must be nil when unconfigured so the writer keeps its default")
	}
}

func TestFromEnv_SASLAndTLS(t *testing.T) {
	t.Setenv("KAFKA_TLS_ENABLED", "true")
	t.Setenv("KAFKA_SASL_USERNAME", "svc-dispatch")
	t.Setenv("KAFKA_SASL_PASSWORD", "s3cr3t")

	s := FromEnv()
	if !s.Enabled() {
		t.Fatal("expected enabled with TLS + SASL set")
	}
	d := s.Dialer()
	if d.SASLMechanism == nil {
		t.Error("dialer missing SASL mechanism")
	}
	if d.TLS == nil {
		t.Error("dialer missing TLS config")
	}
	tr := s.Transport()
	if tr == nil || tr.SASL == nil || tr.TLS == nil {
		t.Error("transport missing SASL/TLS")
	}
}

func TestFromEnv_TLSOnly(t *testing.T) {
	t.Setenv("KAFKA_TLS_ENABLED", "true")
	t.Setenv("KAFKA_SASL_USERNAME", "")
	t.Setenv("KAFKA_SASL_PASSWORD", "")

	s := FromEnv()
	if !s.Enabled() {
		t.Fatal("TLS alone should enable security")
	}
	if s.Dialer().SASLMechanism != nil {
		t.Error("no SASL expected when creds unset")
	}
}

func TestDLQ_NilSafe(t *testing.T) {
	var d *DLQ
	if err := d.Close(); err != nil {
		t.Errorf("nil DLQ Close should be safe, got %v", err)
	}
}
