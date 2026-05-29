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

func TestRegionRouterMiddleware_SuccessQueryParam(t *testing.T) {
	router := middleware.NewRegionRouterMiddleware([]string{"KOL", "BLR"})

	var capturedRegion string
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reg, ok := middleware.GetRegionFromContext(r.Context())
		if ok {
			capturedRegion = reg
		}
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest("GET", "/api/v1/pricing/quote?city_prefix=BLR", nil)

	rr := httptest.NewRecorder()
	router.RouteRegionalTraffic(testHandler).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200 OK, got: %d", rr.Code)
	}
	if capturedRegion != "BLR" {
		t.Errorf("Expected context region to be 'BLR', got: %q", capturedRegion)
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

	req := httptest.NewRequest("GET", "/api/v1/pricing/quote?city_prefix=BOM", nil)

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
