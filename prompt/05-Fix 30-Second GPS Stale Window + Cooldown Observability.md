IMPROVEMENT — Add driver GPS staleness detection and cooldown visibility to prevent silent dispatch exclusions.

## Issue A: 30-second stale window in SpatialScanner

File: `internal/dispatch/repository/spatial_scanner.go` — line 34
The `staleThreshold := now - 30` silently excludes drivers whose GPS hasn't updated in >30s (app backgrounded, network blip).
These drivers appear "online" to themselves but are invisible to the matching engine.

### Fix A1: Log when stale drivers are filtered out

In `ScanNearbyDrivers()`, after filtering by stale threshold:

```go
if filtered > 0 {
    s.logger.Debug("filtered stale drivers from spatial scan",
        zap.Int("stale_count", filtered),
        zap.String("city_prefix", cityPrefix),
        zap.String("h3_cell", h3Cell),
        zap.Int64("threshold_seconds", 30),
    )
}
```

### Fix A2: Expose a driver endpoint to check their own GPS recency

Add to the gateway (authenticated driver routes):

GET /api/v1/driver/location/status

Response: `{"last_seen_seconds_ago": 12, "is_visible_to_dispatch": true}`
Logic: Read the driver's score from `drivers:zset:{cityPrefix}:{h3Cell}`, compare to `now - 30`.
This lets drivers know if their phone's GPS is too stale to receive rides.

### Fix A3: Show GPS warning in driver app

In `client-app/src/app/driver/page.tsx`:

- Poll `GET /api/v1/driver/location/status` every 20 seconds when driver is in "online" mode
- If `is_visible_to_dispatch: false`, show a yellow banner:
  > ⚠️ "Your GPS signal is weak. Move to an open area to receive ride requests."
- Dismiss banner automatically when `is_visible_to_dispatch` becomes `true` again

## Issue B: Cooldown filter has no visibility

File: `internal/dispatch/consumer/order_consumer.go` — line 296
Drivers on cooldown after declining are silently skipped with no indication to the driver.

### Fix B1: Add cooldown status to driver status endpoint

In `GET /api/v1/driver/status` response, add field:

```json
{
  "on_cooldown": true,
  "cooldown_expires_in_seconds": 45
}
```

Read from Redis key `cooldown:driver:{ID}` — check if it exists and get its TTL.

### Fix B2: Show cooldown timer in driver app

In `client-app/src/app/driver/page.tsx`:

- If `on_cooldown: true` in driver status response, show:
  > "You declined a ride. New requests resume in 45s."
- Display a countdown timer using the `cooldown_expires_in_seconds` value

## Rules

- Fix A2 and B1 are backend changes — follow existing handler/route patterns
- Fix A3 and B2 are UI-only — do not change state management or WebSocket logic
- All new backend endpoints must be behind `authGuard.AuthenticateJWT` (driver routes)
