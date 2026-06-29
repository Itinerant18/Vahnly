# Fix Prompts — Booking Flow Debugging

Copy-paste each prompt into Claude Code to fix the corresponding issue.
Ordered by priority (High → Medium → Low).

## Prerequisites
Run before starting any fix:
```
graphify update .
```

## Prompt List
| # | File | Priority | Issue |
|---|---|---|---|
| 1 | `01-fix-resilient-websocket-order-id.md` | 🔴 High | Global WS provider connects without `order_id` |
| 2 | `02-fix-kafka-publish-error-handling.md` | 🔴 High | Kafka publish errors silently discarded |
| 3 | `03-fix-dispatch-service-deployment.md` | 🔴 High | Dispatch is separate service (deployment/docs) |
| 4 | `04-fix-fake-session-order-id.md` | 🟡 Medium | `connectDispatchStream` uses fake session ID |
| 5 | `05-fix-spatial-scanner-stale-window.md` | 🟡 Medium | 30s stale window can drop drivers |
| 6 | `06-fix-cooldown-filter-visibility.md` | 🟡 Medium | Cooldown filter silently skips drivers |
| 7 | `07-fix-redis-zset-cleanup.md` | 🟢 Low | Stale entries in drivers:zset waste memory |
