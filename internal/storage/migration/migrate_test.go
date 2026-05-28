package migration_test

import (
	"os"
	"testing"

	"github.com/platform/driver-delivery/internal/storage/migration"
)

func TestAutoRunDatabaseMigrations_InvalidURL(t *testing.T) {
	err := migration.AutoRunDatabaseMigrations("postgres://invalid:password@localhost:54321/db?sslmode=disable", "file://../../../database/migrations")
	if err == nil {
		t.Fatal("expected error with unreachable/invalid database connection url, got nil")
	}
}

func TestAutoRunDatabaseMigrations_IntegrationSkip(t *testing.T) {
	postgresURL := os.Getenv("DATABASE_URL")
	if postgresURL == "" {
		t.Skip("DATABASE_URL is not set, skipping integration migration validation")
	}

	err := migration.AutoRunDatabaseMigrations(postgresURL, "file://../../../database/migrations")
	if err != nil {
		t.Fatalf("failed migration validation with active DB connection: %v", err)
	}
}
