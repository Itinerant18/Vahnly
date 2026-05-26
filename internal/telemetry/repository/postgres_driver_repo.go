package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/platform/driver-delivery/internal/telemetry/domain"
)

type postgresDriverMetrics struct {
	dbPool *pgxpool.Pool
}

// NewPostgresDriverMetrics returns a DriverMetricsProvider backed by PostgreSQL.
func NewPostgresDriverMetrics(db *pgxpool.Pool) domain.DriverMetricsProvider {
	return &postgresDriverMetrics{dbPool: db}
}

func (p *postgresDriverMetrics) GetDriverMetrics(ctx context.Context, driverID string) (*domain.DriverMetrics, error) {
	const q = `
		SELECT osm_node_id, acceptance_rate, cancellation_rate
		FROM drivers
		WHERE id = $1::uuid
	`
	var osmNodeID int64
	var acceptanceRate float32
	var cancellationRate float32

	err := p.dbPool.QueryRow(ctx, q, driverID).Scan(&osmNodeID, &acceptanceRate, &cancellationRate)
	if err != nil {
		return nil, fmt.Errorf("failed fetching driver metrics for %s: %w", driverID, err)
	}

	return &domain.DriverMetrics{
		OSMNodeID:               osmNodeID,
		AcceptanceRate:          acceptanceRate,
		CancellationProbability: cancellationRate,
	}, nil
}
