package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/platform/driver-delivery/internal/gateway/middleware"
)

func TestRegionRouterMiddleware_SuccessHeader(t *testing.T) {
	router := middleware.NewRegionRouterMiddleware([]string{"KOL", "BLR"})

	var capturedRegion string
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reg, ok := middleware.GetRegionFromContext(r.Context())
		if ok {
			capturedRegion = reg
		}
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest("GET", "/api/v1/pricing/quote", nil)
	req.Header.Set("X-Region-Prefix", "KOL")

	rr := httptest.NewRecorder()
	router.RouteRegionalTraffic(testHandler).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200 OK, got: %d", rr.Code)
	}
	if capturedRegion != "KOL" {
		t.Errorf("Expected context region to be 'KOL', got: %q", capturedRegion)
	}
}

// Security: a ?city_prefix= query param must NOT set the routing region (it could
// route a caller outside their token scope). Region comes from the header / JWT only.
func TestRegionRouterMiddleware_QueryParamRejected(t *testing.T) {
	router := middleware.NewRegionRouterMiddleware([]string{"KOL", "BLR"})

	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// No header, only a query param — must be treated as missing region (400).
	req := httptest.NewRequest("GET", "/api/v1/pricing/quote?city_prefix=BLR", nil)

	rr := httptest.NewRecorder()
	router.RouteRegionalTraffic(testHandler).ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400 (query param must not set region), got: %d", rr.Code)
	}
}

func TestRegionRouterMiddleware_MissingRegion(t *testing.T) {
	router := middleware.NewRegionRouterMiddleware([]string{"KOL", "BLR"})

	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest("GET", "/api/v1/pricing/quote", nil)

	rr := httptest.NewRecorder()
	router.RouteRegionalTraffic(testHandler).ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400 Bad Request, got: %d", rr.Code)
	}
}

func TestRegionRouterMiddleware_UnsupportedRegion(t *testing.T) {
	router := middleware.NewRegionRouterMiddleware([]string{"KOL", "BLR"})

	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest("GET", "/api/v1/pricing/quote", nil)
	req.Header.Set("X-Region-Prefix", "BOM") // unsupported region via the header

	rr := httptest.NewRecorder()
	router.RouteRegionalTraffic(testHandler).ServeHTTP(rr, req)

	if rr.Code != http.StatusNotImplemented {
		t.Errorf("Expected status 501 Not Implemented, got: %d", rr.Code)
	}
	available := rr.Header().Get("X-Available-Regions")
	if available == "" {
		t.Error("Expected X-Available-Regions header to be set")
	}
}
