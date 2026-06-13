# Developer Onboarding — Clone to Running, Step by Step

> **Audience:** you just got a new laptop, you're about to `git clone` this repo,
> and you want every app + the backend running locally.
>
> This is the **full-surface** runbook: Go backend + 3 frontends (admin, driver,
> rider) + mobile shells + tests + monitoring. For the deep backend-infra
> details (Redis MOVED rewrites, OSM graph, k8s path), see **`SETUP.md`** — this
> doc links to it instead of repeating it.

Two ways to read this:

- **Backend only** → do steps 0–4, then jump to step 9 (tests).
- **Frontend / full-stack** → do all steps.

---

## 0. Install prerequisites (once)

| Tool | Version | Needed for | Install |
| --- | --- | --- | --- |
| **Go** | 1.25.x | backend services + tests | https://go.dev/dl/ |
| **Node.js** | 20.x LTS (or newer) | all 3 frontends + e2e | https://nodejs.org/ |
| **Docker Desktop** | 4.x (Compose v2) | local backend infra | https://www.docker.com/ |
| **PowerShell** | 7.4+ (`pwsh`) | bootstrap scripts (Windows) | `winget install Microsoft.PowerShell` |
| **Git** | 2.40+ | clone | preinstalled |
| **kubectl + helm** | 1.29+ / 3.x | *optional* — monitoring stack, k8s path | Docker Desktop / https://helm.sh |
| **Android Studio / Xcode** | latest | *optional* — mobile builds | — |

Verify:

```bash
go version        # go1.25.x
node --version    # v20.x+
docker --version
docker compose version
```

---

## 1. Clone

```bash
git clone <repo-url> Driver
cd Driver
git status        # MUST be clean on a fresh clone
```

If `git status` shows `node_modules/`, `*.exe`, `*/dist/`, `*/.next/`, or `out/`,
your local `.gitignore` got overridden — stop and re-clone.

---

## 2. Backend infra + services (Docker Compose)

This is the fastest path — it brings up Postgres+PostGIS, the 6-shard Redis
cluster, Kafka (KRaft), Triton, the migrator, and all Go services.

```bash
# 2a. Backend env file (consumed by docker-compose.yml)
cp .env.example .env            # Windows: Copy-Item .env.example .env
# Defaults run end-to-end as-is. Only edit for prod-like testing.
# JWT_SECRET must be 32+ bytes (a dev value is provided).

# 2b. One-shot bootstrap (down -v → up -d --build → waits for migrator)
pwsh ./scripts/bootstrap.ps1            # Windows
# ./scripts/bootstrap.sh                 # macOS/Linux (chmod +x first)
```

See `SETUP.md` §3 for what the bootstrap does step by step, and §8/§12 for the
common infra gotchas (Redis `MOVED`, missing OSM graph CSVs, etc.).

---

## 3. Apply migrations (if you skipped the migrator)

```bash
go run ./cmd/migrate
```

Migrations also auto-run on `cmd/dispatch` boot. Single source of truth:
`database/migrations/`.

---

## 4. Verify the backend is healthy

The gateway exposes three probe endpoints (note: these changed — `/health` is
now rich JSON, and liveness moved to `/live`):

```bash
# Lenient liveness — process alive only
curl http://localhost:8080/live
# alive

# Strict readiness — DB + Redis + Kafka all reachable
curl http://localhost:8080/ready
# ready   (503 if any dependency is down)

# Rich diagnostic JSON (used by the uptime monitor)
curl http://localhost:8080/health
# {"status":"ok","services":{"database":"ok","redis":"ok","kafka":"ok"},
#  "version":"dev","uptime_seconds":42}
```

Prometheus metrics are on a **separate internal port** (not 8080):

```bash
curl http://localhost:9090/metrics | grep dfu_
```

Drive synthetic traffic:

```bash
go run ./cmd/simulator
```

---

## 5. Frontend apps

Three independent apps. Each: install deps with `npm ci` (lockfile-exact),
create its env file, run dev. **Use `npm ci`, not `npm install`** — CI enforces
the lockfile.

### 5.1 Admin dashboard — `frontend/` (Vite + React 18, port 5173)

```bash
cd frontend
npm ci
cp .env.example .env            # set VITE_SENTRY_DSN (optional), VITE_API_BASE_URL
npm run dev                     # http://localhost:5173/admin
```

### 5.2 Driver app — `client-app/` (Next.js 16 + Capacitor, port 3000)

```bash
cd client-app
npm ci
cp .env.example .env.local      # then fill the values below
npm run dev                     # http://localhost:3000
```

`client-app/.env.local` keys (template in `.env.example`):

```dotenv
NEXT_PUBLIC_API_GATEWAY=http://localhost:8085      # gateway base (note: 8085 in dev)
NEXT_PUBLIC_FIREBASE_API_KEY=...                   # web push (values already in .env.example)
NEXT_PUBLIC_FCM_VAPID_KEY=<web push public key>    # Firebase Console → Cloud Messaging
NEXT_PUBLIC_SENTRY_DSN=                            # optional; empty = error tracking off
NEXT_PUBLIC_ENV=development
```

> Sentry and Firebase are **no-op when their keys are empty** — the app builds
> and runs fine without them. Fill them only when you need push / error tracking.

### 5.3 Rider app — `rider-app/` (Next.js 16 + Capacitor, port 3050)

```bash
cd rider-app
npm ci
cp .env.example .env.local
npm run dev                     # http://localhost:3050
```

---

## 6. Mobile shells (optional — needs macOS/Android Studio)

Native projects are **not** checked in; generate them once, then the
post-setup scripts wire permissions, Firebase configs, and icons.

```bash
cd client-app                   # or rider-app
npx cap add ios                 # macOS + Xcode only
npx cap add android             # needs Android SDK

# From repo root — copies firebase/ configs, patches manifests/plists, FCM:
./scripts/ios-post-setup.sh client-app
./scripts/android-post-setup.sh client-app
./scripts/generate-icons.sh client-app        # needs imagemagick

# Build web → sync native → open IDE
npm run build:ios && npm run open:ios
npm run build:android && npm run open:android
```

Full mobile/store details: the scripts print remaining manual steps (Firebase
SPM package, signing identity, `google-services.json` is auto-copied from
`firebase/`).

---

## 7. End-to-end tests (Playwright, optional)

```bash
cd e2e
npm ci
npx playwright install chromium

# Start a dev server, then run its project (rider example):
npm --prefix ../rider-app run dev &
npm test -- --project=rider --project=design
```

See `e2e/README.md` for the project↔app↔port matrix.

---

## 8. Linting / type-checking (match CI before you push)

```bash
# Backend
go vet ./...
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
golangci-lint run --timeout=5m

# Each frontend
cd client-app && npm run lint && npm run type-check
cd rider-app  && npm run lint && npm run type-check
cd frontend   && npm run typecheck
```

CI runs these per-app on every PR (`.github/workflows/*-ci.yml`). Match them
locally to avoid red builds.

---

## 9. Tests

```bash
# Backend (unit; integration needs the stack up — see SETUP.md §3.4)
go test -race -count=1 ./internal/...

# Coverage gate (gated pkgs must clear their floor)
pwsh ./scripts/coverage.ps1          # or ./scripts/coverage.sh

# Frontend unit/component
cd client-app && npm test            # Vitest — 25 tests
cd rider-app  && npm test            # Vitest — 14 tests
cd frontend   && npm test            # Jest — 14 tests
```

Test conventions + what's covered: `DOC/TEST_COVERAGE.md` (Go) and
`DOC/TEST_FRONTEND.md` (frontends).

---

## 10. Monitoring stack (optional — needs k8s)

Prometheus + Grafana + Alertmanager, plus the gateway's `dfu_*` metrics. Full
install steps, dashboards, and alert routing are in
**`deploy/monitoring/README.md`**. Not required for app development.

---

## 11. Everyday loop

```bash
# 1. change code
# 2. test the package you touched
go test ./internal/<pkg>/...          # or npm test in the app
# 3. rebuild just the affected service
docker compose up -d --build <service>
docker compose logs -f <service>
# 4. keep the knowledge graph current (AST-only, no API cost)
graphify update .
# 5. tear down when done
pwsh ./scripts/teardown.ps1           # or ./scripts/teardown.sh
```

For codebase questions, query the graph before grepping:
`graphify query "<question>"` / `graphify explain "<concept>"`.

---

## 12. Secrets & gotchas

- **Never commit** `.env`, `.env.local`, keystores, or `.p12` files — they're
  gitignored. Firebase SDK config files (`firebase/*.json|plist`) are **not**
  secrets (safe in the bundle); the VAPID **private** key and `SENTRY_AUTH_TOKEN`
  are. Full list: `.github/SECRETS.md`.
- **Sentry DSNs are per-environment** — never share staging and prod DSNs.
- Dev port quirks: gateway public API `:8080` (compose) / `:8085` (some client
  defaults), metrics `:9090`, admin `:5173`, driver `:3000`, rider `:3050`,
  analytics SSE `:8089`.
- Backend infra failures (Redis MOVED, OSM graph, stuck orders): **`SETUP.md`
  §8 and §12** have the full troubleshooting matrix.

---

## 13. Where to read next

| Topic | Doc |
| --- | --- |
| Deep backend setup + k8s path | `SETUP.md` |
| Architecture & data flow | `DOC/ARCHITECTURE_BREAKDOWN_FOR_TEAM.md` |
| WebSocket / state model | `DOC/STATE_ARCHITECTURE_AND_WEBSOCKET_INTEGRATION.md` |
| Backend test strategy | `DOC/TEST_COVERAGE.md` |
| Frontend test strategy | `DOC/TEST_FRONTEND.md` |
| Monitoring stack | `deploy/monitoring/README.md` |
| Required secrets | `.github/SECRETS.md` |
| Design system | `DOC/UBER_LIKE_UI_UX_DESIGN_GUIDE.md` |
