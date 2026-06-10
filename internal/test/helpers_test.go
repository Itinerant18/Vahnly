package test

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/platform/driver-delivery/internal/gateway/middleware"
)

// getTestDBPool returns a *pgxpool.Pool connected to the integration test database.
// It reads DATABASE_URL from the environment and skips the test when unset.
func getTestDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	postgresURL := os.Getenv("DATABASE_URL")
	if postgresURL == "" {
		postgresURL = "postgresql://postgres:HardenedProdPassword@localhost:5432/delivery_platform?sslmode=disable"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, postgresURL)
	if err != nil {
		t.Fatalf("Failed to connect to test database: %v", err)
	}

	t.Cleanup(func() { pool.Close() })
	return pool
}

// ensureTestDriver inserts a minimal driver row for onboarding tests and returns
// the generated driver UUID string. The row is removed when the test completes.
func ensureTestDriver(t *testing.T, dbPool *pgxpool.Pool) string {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	driverID := "00000000-0000-0000-0000-000000000099"

	// Clean up any leftover from a previous run, then insert a fresh row.
	_, _ = dbPool.Exec(ctx, "DELETE FROM drivers WHERE id = $1::uuid", driverID)

	_, err := dbPool.Exec(ctx, `
		INSERT INTO drivers (id, city_prefix, name, phone, dl_number, current_state, is_verified, acceptance_rate)
		VALUES ($1::uuid, 'KOL', 'Onboarding Tester', '+919000000099', 'DL-ONBOARD-TEST', 'REGISTERED', false, 0.00);
	`, driverID)
	if err != nil {
		t.Fatalf("Failed to seed test driver for onboarding: %v", err)
	}

	t.Cleanup(func() {
		cleanCtx, cleanCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanCancel()
		_, _ = dbPool.Exec(cleanCtx, "DELETE FROM drivers WHERE id = $1::uuid", driverID)
	})

	return driverID
}

// injectDriverContext returns a clone of the request whose context carries the
// given driverID under the middleware.UserIDContextKey, simulating what the
// AuthenticateJWT middleware does for authenticated requests.
func injectDriverContext(r *http.Request, driverID string) *http.Request {
	ctx := context.WithValue(r.Context(), middleware.UserIDContextKey, driverID)
	return r.WithContext(ctx)
}
