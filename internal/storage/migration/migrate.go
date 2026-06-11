package migration

import (
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

// AutoRunDatabaseMigrations intercepts table versions and runs pending up scripts
func AutoRunDatabaseMigrations(postgresConnURL string, migrationsSourcePath string) error {
	log.Printf("[MIGRATION_ENGINE] Reading target data schemas from source: %s", migrationsSourcePath)

	// golang-migrate requires standard postgres:// protocol connections
	var m *migrate.Migrate
	var err error
	maxRetries := 30
	for i := 1; i <= maxRetries; i++ {
		m, err = migrate.New(migrationsSourcePath, postgresConnURL)
		if err == nil {
			break
		}
		log.Printf("[MIGRATION_ENGINE] Database connection attempt %d/%d failed: %v. Retrying in 2s...", i, maxRetries, err)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		return fmt.Errorf("failed instantiating migration driver context after retries: %w", err)
	}
	defer m.Close()

	// Execute all pending upward schema updates sequentially
	err = m.Up()
	if err != nil {
		if errors.Is(err, migrate.ErrNoChange) {
			log.Println("[MIGRATION_ENGINE] Database storage schemas are already fully synchronized. Version locked.")
			return nil
		}
		return fmt.Errorf("critical database migration layout exception: %w", err)
	}

	version, _, _ := m.Version()
	log.Printf("[MIGRATION_ENGINE] Upward migrations completed successfully. Storage layer is current at Version: %d", version)
	return nil
}
