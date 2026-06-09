package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

// WSTicketMiddleware issues and validates single-use, short-lived WebSocket tickets.
//
// WebSocket upgrades from a browser cannot carry an Authorization header, which is
// why the old code accepted the JWT in the ?jwt= query string — leaking long-lived
// tokens into logs and history. Instead, the client first calls POST /api/v1/ws/ticket
// (header-authenticated) to mint a one-time ticket, then connects with ?ticket=. The
// ticket is GETDEL'd on use (single use) and expires in 30s.
type WSTicketMiddleware struct {
	redis *redis.ClusterClient
	jwt   *AuthMiddleware
	ttl   time.Duration
}

func NewWSTicketMiddleware(rc *redis.ClusterClient, jwtMW *AuthMiddleware) *WSTicketMiddleware {
	return &WSTicketMiddleware{redis: rc, jwt: jwtMW, ttl: 30 * time.Second}
}

type wsTicketPayload struct {
	UserID    string `json:"user_id"`
	Role      string `json:"role"`
	CityScope string `json:"city_scope"`
}

// IssueTicket mints a single-use WS ticket for the already-authenticated caller.
// Wire it behind AuthenticateJWT so identity comes from a header-borne Bearer token.
func (m *WSTicketMiddleware) IssueTicket(w http.ResponseWriter, r *http.Request) {
	userID, _ := GetUserIDFromContext(r.Context())
	if userID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	role, _ := GetUserRoleFromContext(r.Context())
	scope, _ := GetCityScopeFromContext(r.Context())

	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		http.Error(w, "ticket_generation_failed", http.StatusInternalServerError)
		return
	}
	ticket := hex.EncodeToString(buf)
	payload, _ := json.Marshal(wsTicketPayload{UserID: userID, Role: role, CityScope: scope})

	if m.redis == nil {
		http.Error(w, "ticket_store_unavailable", http.StatusServiceUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 500*time.Millisecond)
	defer cancel()
	if err := m.redis.Set(ctx, "ws:ticket:"+ticket, payload, m.ttl).Err(); err != nil {
		http.Error(w, "ticket_store_failed", http.StatusServiceUnavailable)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"ticket":             ticket,
		"expires_in_seconds": int(m.ttl.Seconds()),
	})
}

// Authenticate validates a single-use ?ticket= (preferred), injects identity into
// the request context, and proceeds. It transitionally still accepts a ?jwt= token
// (logged as deprecated) so clients can migrate without an outage; remove that
// branch once the driver app and admin SPA both issue tickets (HIGH-009 cleanup).
func (m *WSTicketMiddleware) Authenticate(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if ticket := r.URL.Query().Get("ticket"); ticket != "" {
			if m.redis == nil {
				http.Error(w, "ticket_store_unavailable", http.StatusServiceUnavailable)
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 500*time.Millisecond)
			defer cancel()
			// GETDEL enforces single use — a replayed ticket finds nothing.
			raw, err := m.redis.GetDel(ctx, "ws:ticket:"+ticket).Result()
			if err == nil && raw != "" {
				var p wsTicketPayload
				if json.Unmarshal([]byte(raw), &p) == nil && p.UserID != "" {
					next.ServeHTTP(w, r.WithContext(InjectClaims(r.Context(), &CustomClaims{
						UserID: p.UserID, Role: p.Role, CityScope: p.CityScope,
					})))
					return
				}
			}
			http.Error(w, "invalid_or_expired_ws_ticket", http.StatusUnauthorized)
			return
		}

		// Transitional fallback: accept ?jwt= but warn loudly. Remove once clients migrate.
		if jwtParam := r.URL.Query().Get("jwt"); jwtParam != "" {
			if claims, ok := m.jwt.ValidateToken(jwtParam); ok {
				log.Printf("[WS_AUTH_DEPRECATION] connection authenticated via ?jwt= — switch to POST /api/v1/ws/ticket; path=%s", r.URL.Path)
				next.ServeHTTP(w, r.WithContext(InjectClaims(r.Context(), claims)))
				return
			}
		}

		http.Error(w, "ws_ticket_required", http.StatusUnauthorized)
	}
}
