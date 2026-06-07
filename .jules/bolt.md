## 2026-06-07 - Hungarian Algorithm Optimization

**Learning:** Re-allocating dynamic arrays inside a tight loop creates high GC pressure and memory allocation overhead. In `SolveKuhnMunkres`, `minv` and `used` slices were being re-allocated `n` times inside the main row loop.
**Action:** Lift static-sized allocations outside the loop and clear them manually to reduce overhead.
