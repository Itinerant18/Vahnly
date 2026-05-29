package expiry

import "testing"

func TestOfferTimeoutJanitor_CompileCheck(t *testing.T) {
	// A simple compile-time type-safety check for OfferTimeoutJanitor creation
	var _ *OfferTimeoutJanitor = nil
}
