package main

import (
	"log"
	"os"

	"github.com/platform/driver-delivery/internal/storage/migration"
)

func main() {
	postgresURL := os.Getenv("DATABASE_URL")
	if postgresURL == "" {
		postgresURL = "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable"
	}
	migrationsPath := os.Getenv("DATABASE_MIGRATIONS_PATH")
	if migrationsPath == "" {
		migrationsPath = "file://database/migrations"
	}

	log.Println("Running database migrations...")
	if err := migration.AutoRunDatabaseMigrations(postgresURL, migrationsPath); err != nil {
		log.Fatalf("Migration failed: %v", err)
	}
	log.Println("Migrations completed successfully.")
}
