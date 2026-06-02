package http

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type AdminTripHandler struct {
	dbPool      *pgxpool.Pool
	redisClient *redis.ClusterClient
}

func NewAdminTripHandler(dbPool *pgxpool.Pool, redisClient *redis.ClusterClient) *AdminTripHandler {
	return &AdminTripHandler{
		dbPool:      dbPool,
		redisClient: redisClient,
	}
}

type OrderRecord struct {
	ID              string     `json:"id"`
	CityPrefix      string     `json:"city_prefix"`
	CustomerID      string     `json:"customer_id"`
	Status          string     `json:"status"`
	PickupLat       float64    `json:"pickup_lat"`
	PickupLng       float64    `json:"pickup_lng"`
	DropoffLat      float64    `json:"dropoff_lat"`
	DropoffLng      float64    `json:"dropoff_lng"`
	PickupH3Cell    string     `json:"pickup_h3_cell"`
	AssignedDriver  *string    `json:"assigned_driver_id"`
	SurgeMultiplier float64    `json:"surge_multiplier"`
	BaseFarePaise   int64      `json:"base_fare_paise"`
	CreatedAt       time.Time  `json:"created_at"`
	AssignedAt      *time.Time `json:"assigned_at"`
}

func (h *AdminTripHandler) HandleAdminGetOrders(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, city_prefix, customer_id, status, 
		       ST_Y(pickup_location::geometry) as pickup_lat, ST_X(pickup_location::geometry) as pickup_lng,
		       ST_Y(dropoff_location::geometry) as dropoff_lat, ST_X(dropoff_location::geometry) as dropoff_lng,
		       pickup_h3_cell, assigned_driver_id, surge_multiplier, base_fare_paise, created_at, assigned_at
		FROM orders
		ORDER BY created_at DESC LIMIT 50;
	`

	rows, err := h.dbPool.Query(ctx, query)
	if err != nil {
		http.Error(w, "orders_fetch_exception", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var orders []OrderRecord = []OrderRecord{}
	for rows.Next() {
		var rec OrderRecord
		err := rows.Scan(
			&rec.ID, &rec.CityPrefix, &rec.CustomerID, &rec.Status,
			&rec.PickupLat, &rec.PickupLng, &rec.DropoffLat, &rec.DropoffLng,
			&rec.PickupH3Cell, &rec.AssignedDriver, &rec.SurgeMultiplier, &rec.BaseFarePaise,
			&rec.CreatedAt, &rec.AssignedAt,
		)
		if err == nil {
			orders = append(orders, rec)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(orders)
}

type CancelOrderRequest struct {
	OrderID string `json:"order_id"`
}

func (h *AdminTripHandler) HandleAdminCancelOrder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CancelOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_request_payload", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Transactionally cancel the order and free up the driver if assigned
	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction_init_failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var assignedDriverID *string
	queryFindDriver := `
		SELECT assigned_driver_id 
		FROM orders 
		WHERE id = $1
	`
	err = tx.QueryRow(ctx, queryFindDriver, req.OrderID).Scan(&assignedDriverID)
	if err != nil {
		http.Error(w, "order_not_found", http.StatusNotFound)
		return
	}

	queryCancelOrder := `
		UPDATE orders 
		SET status = 'CANCELLED'::order_status_enum 
		WHERE id = $1
	`
	_, err = tx.Exec(ctx, queryCancelOrder, req.OrderID)
	if err != nil {
		http.Error(w, "failed_to_cancel_order", http.StatusInternalServerError)
		return
	}

	if assignedDriverID != nil {
		queryFreeDriver := `
			UPDATE drivers 
			SET current_state = 'ONLINE_AVAILABLE'::driver_state_enum 
			WHERE id = $1
		`
		_, err = tx.Exec(ctx, queryFreeDriver, *assignedDriverID)
		if err != nil {
			http.Error(w, "failed_to_free_driver", http.StatusInternalServerError)
			return
		}

		// Also purge active offers or leases from Redis Cluster
		offerKey := "offer:lease:" + req.OrderID
		_ = h.redisClient.Del(ctx, offerKey).Err()
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed_to_commit_cancellation", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}
