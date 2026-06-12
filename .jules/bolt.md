## 2024-11-20 - Remove unnecessary mutex locks in sequential algorithms
**Learning:** In the backend routing logic (`internal/routing/graph/contraction_hierarchies.go`), `ComputeShortestPathETA` functions run sequentially but contained unnecessary `sync.Mutex` locks over local heap/map operations. These locks added useless overhead to tight algorithmic loops.
**Action:** Remove `mu.Lock()`/`mu.Unlock()` when the underlying data structures (e.g. priority queues and visited maps) are completely local to the function execution context and not accessed by concurrent goroutines.
