## 2024-06-06 - Batching Redis Lookups for candidate cooldowns
**Learning:** Sequential Redis calls inside batch processing loops (N+1 queries for cache/cooldown lookups) severely degrade throughput in high-volume consumers like `order_consumer`. A single `Exists` network roundtrip per nearby driver accumulates large latencies before Hungarian/Greedy matching logic even begins.
**Action:** Use `redis.Pipeline()` to batch simple queries like `Exists` or `Get` when iterating through dynamic candidate pools to consolidate network round trips and unblock the fast path.
