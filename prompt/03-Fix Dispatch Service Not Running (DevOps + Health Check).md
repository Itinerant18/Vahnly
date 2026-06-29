INFRA FIX — Dispatch service is a separate binary that must run independently. Add health checks and startup guards so the system fails loudly when it's missing.

## The Problem

`cmd/dispatch/main.go` is a separate Go binary from `cmd/gateway/main.go`.
If only the gateway is started (common dev/deploy mistake), orders are created but NEVER matched.
Currently there is no health check, no startup warning, and no way to tell from the rider app that dispatch is down.

## Fix 1: Add a dispatch health endpoint to the GATEWAY

In `cmd/gateway/main.go`, add a new public health route:

GET /api/v1/health/dispatch

Handler logic:

1. Ping Kafka topic `order.created` — check if it's reachable and has a consumer group registered for it
2. Check Redis key `dispatch:heartbeat` — the dispatch service should write this key every 30 seconds
3. If both pass → return `{"status": "ok", "dispatch": "running"}`
4. If either fails → return HTTP 503 `{"status": "degraded", "dispatch": "unreachable", "reason": "..."}`

## Fix 2: Dispatch service writes a heartbeat to Redis

In `cmd/dispatch/main.go`, in the main loop (or in a background goroutine), add:

```go
go func() {
    ticker := time.NewTicker(15 * time.Second)
    defer ticker.Stop()
    for range ticker.C {
        redisClient.Set(ctx, "dispatch:heartbeat", time.Now().Unix(), 60*time.Second)
    }
}()
```

This gives the gateway a way to detect if dispatch has been offline for >60 seconds.

## Fix 3: Gateway logs a startup warning if dispatch is unreachable

In `cmd/gateway/main.go` startup sequence (after all services are initialized, before `http.ListenAndServe`):

```go
if err := checkDispatchHeartbeat(redisClient); err != nil {
    log.Warn("⚠️  DISPATCH SERVICE NOT DETECTED — bookings will be created but not matched",
        zap.Error(err))
}
```

## Fix 4: Rider app shows "matching" state, not silent hang

In `rider-app/app/(app)/booking/confirm/page.tsx`:

- After order is created, poll `GET /api/v1/rider/orders/active` every 3 seconds
- If after 90 seconds the order still has status `"pending"` (no driver matched), show:
  > "We're having trouble finding a driver right now. Please try again or contact support."
- With a "Cancel & Retry" button that calls `POST /api/v1/rider/orders/{id}/cancel`

## Rules

- Follow existing patterns for Redis client and health check handlers in the codebase
- Do NOT change the dispatch matching logic — only add observability
- Fix 4 (rider app) is UI-only — do not change API calls or state management
