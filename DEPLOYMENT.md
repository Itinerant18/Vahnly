# Deployment

How every part of Vahnly ships. Monorepo with a Go backend and three web/mobile
front ends, plus GitHub Actions CI.

## At a glance

| Component | Path | Ships to | Trigger | Live URL |
|---|---|---|---|---|
| Backend gateway (prod) | `cmd/ internal/ pkg/` | **GCP VM** `dfu-stack` (Docker Compose) | Backend CI success on `main` → `vm-deploy.yml` | https://api.aniket.site |
| Backend gateway (k8s) | same | Kubernetes (Helm) — **currently inactive** | Backend CI success → `deploy.yml` | — |
| Rider app | `rider-app/` | **Firebase Hosting** `vahnly-rider` | **manual** `firebase deploy` | https://vahnly-rider.web.app |
| Driver app | `client-app/` | **Firebase Hosting** `vahnly-driver` | **manual** `firebase deploy` | https://vahnly-driver.web.app |
| Admin / platform | `frontend/` | **Firebase Hosting** `vahnly-platform` | **manual** `firebase deploy` | https://vahnly-platform.web.app |
| Docker images | services | GHCR (`ghcr.io/itinerant18/…`) | git tag `v*` → `release.yml` | — |
| Mobile (Android/iOS) | Capacitor apps | build artifacts | git tag `v*` → `mobile-build.yml` | — |

Firebase project for all three front ends: **`vahnly-platform`**.

---

## Frontend → Firebase Hosting (manual)

The three web apps are **not** deployed by CI — CI only lints, type-checks,
tests, and builds an artifact. Deploy is a manual step from the app directory.

| App dir | Firebase site | Build output | Framework |
|---|---|---|---|
| `rider-app` | `vahnly-rider` | `out/` | Next.js (`output: "export"`) |
| `client-app` | `vahnly-driver` | `out/` | Next.js (`output: "export"`) |
| `frontend` | `vahnly-platform` | `dist/` | Vite (admin) |

### Deploy commands

Run from the app's own directory (each has its own `firebase.json` + `.firebaserc`):

```bash
# Rider app
cd rider-app && npm run build && firebase deploy --only hosting:vahnly-rider --project vahnly-platform

# Driver app
cd client-app && npm run build && firebase deploy --only hosting:vahnly-driver --project vahnly-platform

# Admin / platform
cd frontend && npm run build && firebase deploy --only hosting:vahnly-platform --project vahnly-platform
```

### Gotchas

- **Use the site id, not a target.** `firebase.json` sets `site: "<site-id>"`
  directly. `--only hosting:<site-id>` (e.g. `hosting:vahnly-rider`) always
  resolves. `.firebaserc` may declare a *target* (e.g. `rider`) that was never
  applied — `--only hosting:rider` then errors `target rider not detected`.
  To enable the short target name once: `firebase target:apply hosting rider vahnly-rider`.
- **Auth:** `firebase login` (deploys have run as `karmakaraniket018@gmail.com`,
  which has `vahnly-platform` access). CI has no Firebase deploy step, so there
  is no service-account path yet.
- **CI is not a deploy gate.** A red Rider/Driver/Admin CI does not block a
  manual `firebase deploy`; the deploy uses whatever `build` produces locally.

---

## Backend → GCP

Both backend deploy workflows run **only after Backend CI succeeds on `main`**
(or via manual `workflow_dispatch`). Backend CI is path-filtered to
`cmd/ internal/ pkg/ database/migrations/ go.mod go.sum` — so a frontend-only
push never triggers a backend deploy.

### 1. VM — the live production backend (`vm-deploy.yml`)

Serves `api.aniket.site` behind Caddy.

- VM: `dfu-stack`, zone `asia-south1-c`, project `vahnly-platform`.
- Auth: secret **`GCP_SA_KEY`** (SA with `compute.instanceAdmin.v1` +
  `iam.serviceAccountUser`). Absent → job skips green.
- SSHes in as user **`itine`** (repo-checkout owner), then:
  `git fetch origin main` → `git reset --hard origin/main` →
  `docker compose pull` → `docker compose up -d --build --remove-orphans`.
  The compose builds app services **from source**, so this is a build-from-checkout,
  not an image pull.
- Optional repo variables: `VM_COMPOSE_DIR` (compose dir; auto-discovered if unset),
  `VM_SSH_USER` (default `itine`), `VM_HEALTH_URL`.
- Smoke test: `GET https://api.aniket.site/api/v1/config/flags` → 200.

Manual run: Actions → **VM Deploy** → Run workflow.

### 2. Kubernetes — currently inactive (`deploy.yml`)

Helm deploy of the `vahnly` chart (`deploy/charts/vahnly`, values
`deploy/production-values.yaml`), image `ghcr.io/<owner>/dfu-gateway:<sha>`,
to namespaces `dfu-staging` then `dfu-production`.

- Gated on secrets **`KUBECONFIG_STAGING`** / **`KUBECONFIG_PRODUCTION`**.
  Both absent today → jobs skip green, so k8s is effectively a **no-op**; the VM
  path above is what actually serves prod.
- Smoke test: `GET https://api.aniket.site/health` → `{"status":"ok"}`.
- Rollback on failure: `helm rollback vahnly`.

---

## Tag-driven builds

Pushing a `v*` git tag triggers:

- **`release.yml`** — builds & pushes Docker images (service matrix incl.
  `analytics`) to GHCR.
- **`mobile-build.yml`** — builds the Capacitor Android/iOS apps.

```bash
git tag v1.2.3 && git push origin v1.2.3
```

---

## CI workflows (path-filtered, build/lint/test only)

| Workflow | Runs on changes to | Does |
|---|---|---|
| Backend CI (`backend-ci.yml`) | `cmd/ internal/ pkg/ database/migrations/ go.*` | Go test/build, push images; **gates both backend deploys** |
| Rider App CI (`rider-app-ci.yml`) | `rider-app/** e2e/**` | lint, type-check, test, build, Playwright e2e; uploads `out/` artifact |
| Driver App CI (`driver-app-ci.yml`) | `client-app/**` | lint, type-check, test, build |
| Admin CI (`admin-ci.yml`) | `frontend/** e2e/**` | lint, type-check, test, build |

Lint note: generated `android/**` build artifacts are gitignored → absent in a
fresh CI checkout, so they never fail CI lint even though they can locally.

---

## Secrets & variables (GitHub repo)

| Name | Kind | Used by | Effect if missing |
|---|---|---|---|
| `GCP_SA_KEY` | secret | VM Deploy | VM deploy skips (green) |
| `KUBECONFIG_STAGING` | secret | Deploy (k8s) | staging deploy skips (green) |
| `KUBECONFIG_PRODUCTION` | secret | Deploy (k8s) | production deploy skips (green) |
| `VM_COMPOSE_DIR` | variable | VM Deploy | auto-discovered on VM |
| `VM_SSH_USER` | variable | VM Deploy | defaults to `itine` |
| `VM_HEALTH_URL` | variable | VM Deploy | defaults to config-flags endpoint |

---

## Quick reference

```bash
# Ship a frontend change (example: rider)
cd rider-app && npm run build && firebase deploy --only hosting:vahnly-rider --project vahnly-platform

# Ship a backend change
git push origin main            # Backend CI → VM Deploy (auto, if GCP_SA_KEY set)
# or: Actions → VM Deploy → Run workflow

# Cut a release (images + mobile)
git tag vX.Y.Z && git push origin vX.Y.Z
```
