# Fix: Stale Entries in Redis `drivers:zset`

**Priority:** 🟢 Low
**File:** `internal/gateway/delivery/http/handler.go`

## Problem

The `drivers:zset:{cityPrefix}:{h3Cell}` keys have a 24-hour TTL (line 2773), and entries are added with a score of `now`. When a driver leaves an H3 cell (or goes offline), their entry stays in the zset — the score just goes stale. The spatial scanner filters by score (`now - 30`), so stale entries are never returned in results, but they waste Redis memory.

A driver moving between cells at line 2770:

```go
if previousCell != "" && previousCell != h3Cell {
    oldSpatialZSetKey := fmt.Sprintf("drivers:zset:%s:%s", req.CityPrefix, previousCell)
    pipe.ZRem(ctx, oldSpatialZSetKey, req.DriverID)
}
```

This cleans up the OLD cell, BUT:

- If the driver goes offline normally, no cleanup happens — their entry remains in the last zset
- If the driver's app crashes, same issue
- Over time, cells accumulate stale entries

## Fix Options

1. **Add ZRem in the offline handler** — when driver goes offline, remove from current zset
2. **Add a periodic cleanup job** — background goroutine that scans zsets and removes entries with scores older than 60s + runs every 5 minutes
3. **Use ZRemRangeByScore before each scan** — in `ScanNearbyDrivers`, after reading drivers, remove entries older than stale threshold (minor cleanup but only on read)
4. **Reduce key TTL** — lower from 24h to 1h to bound memory growth (driver will re-insert on next GPS ping)

## Related

- `spatial_scanner.go` — where the zset is queried
- Look for an offline/duty-change handler that could trigger ZRem
