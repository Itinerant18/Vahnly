# Frontend Test Suite

Unit/component tests per app + a cross-app Playwright e2e/visual suite.

## What runs where

| App | Runner | Env | Command | Tests |
|---|---|---|---|---|
| `client-app` (driver) | Vitest 4 | jsdom | `npm test` | 25 — FareDisplay, BottomSheet, useAuthStore + the API-client smoke test |
| `rider-app` | Vitest 4 | jsdom | `npm test` | 14 — FareDisplay/BottomSheet via shared DS, authStore, OTPDisplay, BookingSheet |
| `frontend` (admin) | Jest 30 + ts-jest | jsdom (per-file) | `npm test` | DataTable (8) + existing network test |
| `e2e` | Playwright | chromium | `npm test` | rider-auth, rider-booking, design-system (live-verified); admin-kyc + visual scaffolds |

Run everything:

```bash
( cd client-app && npm test )
( cd rider-app  && npm test )
( cd frontend   && npm test )
( cd e2e && npx playwright install chromium && npm --prefix ../rider-app run dev &  npm test -- --project=rider --project=design )
```

## Conventions

- **No testify-equivalent magic** — hand-written `vi.mock` / `jest.mock` at the
  module boundary; no real network in unit tests.
- **Capacitor + storage are mocked in `src/test/setup.ts`.** jsdom's `localStorage`
  is unreliable under Vitest 4 (missing `setItem`), so setup installs a clean
  in-memory `Storage` — required for the zustand `persist` stores.
- **Component tests are co-located** (`Foo.test.tsx` next to `Foo.tsx`) to avoid
  path-alias friction; cross-module mocks that reference `@/...` rely on the alias
  configured in each `vitest.config.ts`.
- **frontend (Jest)** keeps `testEnvironment: 'node'` globally for the existing
  network test; component specs opt into jsdom with a `/** @jest-environment jsdom */`
  docblock. The global setup imports only jest-dom matchers (DOM-safe); RTL is
  imported per-file and auto-cleans.

## Reality vs the original brief

The brief assumed components/behaviour that differ from the code; tests target
what exists:

- **`BookingCard`** is a trivial `{title, children}` wrapper — the real booking UI
  is **`BookingSheet`** (tested instead).
- **`DataTable`** has sort/select/export/loading/empty but **no built-in search** —
  the search-filter test was dropped (feature absent).
- **`BottomSheet`** has no Escape-to-close handler — only backdrop-tap + drag close.
- The rider **auth store has no `error` field**; `verifyOTP` rejects and the form
  surfaces the error, so the test asserts the rejection + untouched token.

## Fixed: stale smoke-test URLs (was mistaken for an msw bug)

`client-app/src/api/client.test.ts` failed on every request with
`[MSW] Cannot bypass a request when using the "error" strategy`. The cause was
**not** msw — the test's msw handlers had two stale targets the API had moved on
from, so every request missed its handler and msw's `onUnhandledRequest: 'error'`
threw on the bypass:

- gateway base URL `http://localhost:8080` → `http://localhost:8085`
- driver login path `/api/v1/auth/driver/login` → `/api/v1/driver/login`

Aligning both to the values in `src/api/client.ts` fixes all 12. The smoke test
now runs in the default `npm test` lane (no exclude) — `client-app` is 25/25.

## e2e / visual

See `e2e/README.md`. rider-auth, rider-booking (home render), and design-system
(light/dark `data-theme`) are **verified live** against `rider-app` dev. The full
booking→dispatch nav (`fixme`), realtime WS step (`skip`), admin-kyc, and the
visual baselines are documented scaffolds to finish in-environment.
