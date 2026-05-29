package expiry

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	
	gatewayHttp "github.com/platform/driver-delivery/internal/gateway/delivery/http"
)

type OfferTimeoutJanitor struct {
	dbPool         *pgxpool.Pool
	clusterClient  *redis.ClusterClient
	gatewayHandler *gatewayHttp.GatewayHandler
	sweepInterval  time.Duration
	offerTTL       time.Duration
}

func NewOfferTimeoutJanitor(db *pgxpool.Pool, client *redis.ClusterClient, gh *gatewayHttp.GatewayHandler) *OfferTimeoutJanitor {
	return &OfferTimeoutJanitor{
		dbPool:         db,
		clusterClient:  client,
		gatewayHandler: gh,
		sweepInterval:  5 * time.Second,  // Aggressively monitor state boundaries every 5 seconds
		offerTTL:       15 * time.Second, // Hard timeout constraint boundary
	}
}

func (j *OfferTimeoutJanitor) StartJanitorLoop(ctx context.Context, cityPrefix string) {
	log.Printf("[JANITOR_DAEMON] Starting Offer Timeout Janitor background task loop for region [%s]", cityPrefix)
	ticker := time.NewTicker(j.sweepInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			j.SweepExpiredOffers(ctx, cityPrefix)
		}
	}
}

func (j *OfferTimeoutJanitor) SweepExpiredOffers(ctx context.Context, cityPrefix string) {
	sweepCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	// Locate orders stuck in ASSIGNED state past the allowed 15-second offer window
	query := `
		SELECT id, assigned_driver_id 
		FROM orders 
		WHERE city_prefix = $1 
		  AND status = 'ASSIGNED'::order_status_enum 
		  AND assigned_at < NOW() - $2::interval;
	`

	intervalStr := fmt.Sprintf("%d seconds", int(j.offerTTL.Seconds()))
	rows, err := j.dbPool.Query(sweepCtx, query, cityPrefix, intervalStr)
	if err != nil {
		return
	}
	defer rows.Close()

	type expiredOffer struct {
		OrderID  string
		DriverID string
	}
	var expiredList []expiredOffer

	for rows.Next() {
		var eo expiredOffer
		if err := rows.Scan(&eo.OrderID, &eo.DriverID); err == nil {
			expiredList = append(expiredList, eo)
		}
	}

	if len(expiredList) == 0 {
		return
	}

	log.Printf("[JANITOR_DAEMON] Detected %d expired driver offers. Executing cascading rollbacks...", len(expiredList))

	for _, offer := range expiredList {
		// Invoke the rollback module to reset the order to CREATED and put the driver on a match cooldown
		err := j.gatewayHandler.RollbackAssignmentToCreated(ctx, offer.OrderID, offer.DriverID, cityPrefix)
		if err != nil {
			log.Printf("[JANITOR_ERROR] Automated expiration rollback failed for order %s: %v", offer.OrderID, err)
		} else {
			log.Printf("[JANITOR_RECOVERED] Order %s crossed offer lease limits. Driver %s evicted; order successfully re-queued to Kafka.", offer.OrderID, offer.DriverID)
		}
	}
}
