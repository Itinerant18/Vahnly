BUG FIX — Kafka publish error in BookingService is silently discarded, causing ghost bookings (rider sees success, driver never gets dispatched).

## File

`internal/rider/service/booking_service.go` — line 562

## The Problem

```go
_ = s.publisher.Publish(ctx, "order.created", orderID, payloadBytes)
```

The error is explicitly thrown away with `_`. If Kafka is down, the order is created in Postgres but the dispatch event is NEVER published. The rider gets a success response but no driver will ever be matched.

## Fix — implement in this exact order

### 1. Handle the Kafka publish error

Replace the discard with proper error handling:

```go
if err := s.publisher.Publish(ctx, "order.created", orderID, payloadBytes); err != nil {
    // Log with full context for ops visibility
    s.logger.Error("failed to publish order.created to Kafka",
        zap.String("order_id", orderID),
        zap.String("rider_id", riderID),
        zap.Error(err),
    )
    // Mark the order as dispatch_failed in Postgres so it can be retried
    _ = s.repo.UpdateOrderStatus(ctx, orderID, "dispatch_failed")
    // Return error to rider — do NOT silently succeed
    return nil, fmt.Errorf("booking created but dispatch unavailable, please retry: %w", err)
}
```

### 2. Add an order status enum value

Search for where order statuses are defined (likely `internal/rider/domain/order.go` or similar).
Add `"dispatch_failed"` as a valid status if it doesn't exist.

### 3. Add a retry/recovery mechanism (separate function)

Add a new method `RetryDispatchFailedOrders(ctx context.Context) error` to BookingService:

- Query Postgres for orders with status `dispatch_failed` AND `created_at > now - 10 minutes`
- Re-publish each to Kafka topic `order.created`
- On success, update status back to `"pending"`
- This can be called by a cron/ticker in `cmd/gateway/main.go` every 60 seconds

### 4. In `cmd/gateway/main.go` — add the retry ticker

Find where background workers are started. Add:

```go
go func() {
    ticker := time.NewTicker(60 * time.Second)
    defer ticker.Stop()
    for range ticker.C {
        if err := bookingSvc.RetryDispatchFailedOrders(context.Background()); err != nil {
            log.Error("dispatch retry failed", zap.Error(err))
        }
    }
}()
```

## Rules

- Follow existing error handling patterns in the same file (zap logger, same return types)
- Do NOT change the happy path — only add error handling when Kafka fails
- Run `go build ./...` after changes and fix any compile errors
