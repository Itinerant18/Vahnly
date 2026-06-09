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

		// Cross-check against the caller's token scope when authenticated. This closes
		// the cross-region replay where a KOL-scoped token sets X-Region-Prefix: BLR.
		// Public routes (no auth middleware) carry no scope and are validated only
		// against the supported-regions set above.
		if scope, ok := GetCityScopeFromContext(r.Context()); ok && scope != "" {
			if !scopeContainsRegion(scope, region) {
				http.Error(w, "region_outside_token_city_scope", http.StatusForbidden)
				return
			}
		}

		// Inject the validated region code down into the request context pipeline
		ctx := context.WithValue(r.Context(), RegionPrefixContextKey, region)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

// scopeContainsRegion reports whether the comma-separated city_scope claim
// (e.g. "KOL,BLR") authorizes the already-uppercased target region.
func scopeContainsRegion(scope, region string) bool {
	for _, s := range strings.Split(scope, ",") {
		if strings.ToUpper(strings.TrimSpace(s)) == region {
			return true
		}
	}
	return false
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
