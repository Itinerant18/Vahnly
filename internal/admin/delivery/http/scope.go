package http

import (
	"context"
	"strings"

	"github.com/platform/driver-delivery/internal/gateway/middleware"
)

// adminAllowedCities returns the upper-cased city codes the requesting admin is
// scoped to. A nil/empty result means "no restriction" — applies to SUPER_ADMIN,
// an explicit "ALL" scope, or a missing scope claim (older tokens issued before
// city_scope was added to the JWT). Callers should treat nil as "return everything".
func adminAllowedCities(ctx context.Context) []string {
	if role, ok := middleware.GetUserRoleFromContext(ctx); ok && strings.EqualFold(role, "SUPER_ADMIN") {
		return nil
	}
	scope, ok := middleware.GetCityScopeFromContext(ctx)
	if !ok || strings.TrimSpace(scope) == "" {
		return nil
	}
	parts := strings.Split(scope, ",")
	cities := make([]string, 0, len(parts))
	for _, p := range parts {
		c := strings.ToUpper(strings.TrimSpace(p))
		if c == "" {
			continue
		}
		if c == "ALL" {
			return nil
		}
		cities = append(cities, c)
	}
	return cities
}
