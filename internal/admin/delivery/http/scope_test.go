package http

import (
	"context"
	"testing"

	"github.com/platform/driver-delivery/internal/gateway/middleware"
)

func ctxWith(role, scope string) context.Context {
	ctx := context.Background()
	ctx = context.WithValue(ctx, middleware.UserRoleContextKey, role)
	ctx = context.WithValue(ctx, middleware.CityScopeContextKey, scope)
	return ctx
}

func TestAdminAllowedCities(t *testing.T) {
	tests := []struct {
		name  string
		role  string
		scope string
		want  []string // nil means "no restriction"
	}{
		{"super admin ignores scope", "SUPER_ADMIN", "KOL", nil},
		{"super admin lowercase", "super_admin", "KOL,BLR", nil},
		{"empty scope means unrestricted", "OPERATIONS_MANAGER", "", nil},
		{"ALL scope means unrestricted", "CITY_MANAGER", "ALL", nil},
		{"all lowercase among list collapses to unrestricted", "CITY_MANAGER", "KOL,all", nil},
		{"single city", "CITY_MANAGER", "KOL", []string{"KOL"}},
		{"multi city normalised", "CITY_MANAGER", "kol, blr ,Pun", []string{"KOL", "BLR", "PUN"}},
		{"blank segments skipped", "CITY_MANAGER", "KOL,,, BLR", []string{"KOL", "BLR"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := adminAllowedCities(ctxWith(tt.role, tt.scope))
			if tt.want == nil {
				if got != nil {
					t.Fatalf("expected nil (unrestricted), got %v", got)
				}
				return
			}
			if len(got) != len(tt.want) {
				t.Fatalf("expected %v, got %v", tt.want, got)
			}
			for i := range tt.want {
				if got[i] != tt.want[i] {
					t.Fatalf("at %d expected %q, got %q (full: %v)", i, tt.want[i], got[i], got)
				}
			}
		})
	}
}

func TestAdminAllowedCities_MissingClaims(t *testing.T) {
	// No role/scope in context at all → unrestricted (older tokens / public flows).
	if got := adminAllowedCities(context.Background()); got != nil {
		t.Fatalf("expected nil for empty context, got %v", got)
	}
}
