package middleware

import (
	"context"
	"net/http"
	"strings"
)

type RegionContextKey string

const RegionPrefixContextKey RegionContextKey = "regionPrefix"

type RegionRouterMiddleware struct {
	allowedRegions map[string]bool
}

func NewRegionRouterMiddleware(supportedRegions []string) *RegionRouterMiddleware {
	regionsMap := make(map[string]bool)
	for _, r := range supportedRegions {
		regionsMap[strings.ToUpper(r)] = true
	}
	return &RegionRouterMiddleware{allowedRegions: regionsMap}
}

// RouteRegionalTraffic filters requests based on the spatial region prefix
func (m *RegionRouterMiddleware) RouteRegionalTraffic(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Inspect headers first, fall back to URL query parameters
		region := r.Header.Get("X-Region-Prefix")
		if region == "" {
			region = r.URL.Query().Get("city_prefix")
		}

		region = strings.ToUpper(strings.TrimSpace(region))
		if region == "" {
			http.Error(w, "missing_required_region_context_prefix", http.StatusBadRequest)
			return
		}

		// Verify if the targeted region is currently supported and enabled on this edge pod cluster
		if !m.allowedRegions[region] {
			w.Header().Set("X-Available-Regions", m.getJoinedRegions())
			http.Error(w, "targeted_region_shard_not_supported_or_inactive", http.StatusNotImplemented)
			return
		}

		// Inject the validated region code down into the request context pipeline
		ctx := context.WithValue(r.Context(), RegionPrefixContextKey, region)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

func (m *RegionRouterMiddleware) getJoinedRegions() string {
	var list []string
	for k := range m.allowedRegions {
		list = append(list, k)
	}
	return strings.Join(list, ", ")
}

// GetRegionFromContext extracts the validated region prefix safely within downstream handlers
func GetRegionFromContext(ctx context.Context) (string, bool) {
	region, ok := ctx.Value(RegionPrefixContextKey).(string)
	return region, ok
}
