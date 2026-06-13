# GitHub Actions Secrets

All secrets are referenced in workflows as `${{ secrets.NAME }}`. Never embed secret
values in workflow YAML. Set them in **Settings → Secrets and variables → Actions**.

## Required secrets

### Container registry

| Secret | Description | How to create |
|---|---|---|
| `GHCR_TOKEN` | GitHub PAT with `write:packages` scope | Settings → Developer settings → Personal access tokens |

### Kubernetes

| Secret | Description | How to create |
|---|---|---|
| `KUBECONFIG_STAGING` | base64-encoded kubeconfig for the staging cluster | `base64 -w0 ~/.kube/staging.yaml` |
| `KUBECONFIG_PRODUCTION` | base64-encoded kubeconfig for the production cluster | `base64 -w0 ~/.kube/prod.yaml` |

### Backend runtime secrets (Kubernetes — NOT GitHub Actions)

These are injected into pods via Kubernetes SealedSecrets or an external-secret operator.
They do NOT need to be added to GitHub Actions secrets. Use `deploy/charts/drivers-for-u/templates/secrets.yaml`.

| Secret | Description |
|---|---|
| `JWT_SECRET_KEY` | 32-byte random key for signing JWTs |
| `DATABASE_URL` | Full PostgreSQL connection string, e.g. `postgres://user:pass@host:5432/dfu?sslmode=require` |
| `REDIS_URL` | Redis connection string, e.g. `redis://:password@host:6379` |
| `KAFKA_BROKERS` | Comma-separated broker list, e.g. `broker1:9092,broker2:9092` |
| `S3_ACCESS_KEY` | AWS or MinIO access key ID |
| `S3_SECRET_KEY` | AWS or MinIO secret access key |

### Mobile builds

| Secret | Description |
|---|---|
| `APPLE_SIGNING_CERT` | base64-encoded `.p12` signing certificate |
| `APPLE_SIGNING_PASSWORD` | Password for the `.p12` file |
| `APPLE_ID` | Apple ID email for TestFlight upload |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password (appleid.apple.com) |
| `ANDROID_KEYSTORE` | base64-encoded Android release keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias inside the keystore |
| `ANDROID_KEY_PASSWORD` | Key password |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | JSON key for the Google Play service account |

### Frontend runtime

| Secret | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Gateway base URL injected at mobile build time |
| `NEXT_PUBLIC_FCM_VAPID_KEY` | Firebase Web Push VAPID key — generate at Firebase Console → Project Settings → Cloud Messaging → Web Push Certificates |

### Firebase (NOT GitHub Actions secrets)

Firebase SDK configs are **not secrets** — they're embedded in the app bundle and safe to commit.
They live in `firebase/` and are auto-copied by the setup scripts.

| File | Used by |
|---|---|
| `firebase/google-services.json` | Android (both apps — Gradle matches by `package_name`) |
| `firebase/GoogleService-Info-driver.plist` | iOS driver app (`client-app`) |
| `firebase/GoogleService-Info-rider.plist` | iOS rider app (`rider-app`) |

Firebase project: `drivers-for-u` · Project number: `10934049772`

The only true Firebase secret is the **VAPID key** (for web push), which goes in `.env.local`
as `NEXT_PUBLIC_FCM_VAPID_KEY` and in GitHub Actions if web push is served from CI builds.

### Observability (optional)

| Secret | Description |
|---|---|
| `CODECOV_TOKEN` | Codecov upload token (backend coverage) |
| `SENTRY_DSN_DRIVER` | Sentry DSN for the driver app → injected at build as `NEXT_PUBLIC_SENTRY_DSN` |
| `SENTRY_DSN_RIDER` | Sentry DSN for the rider app → `NEXT_PUBLIC_SENTRY_DSN` |
| `SENTRY_DSN_ADMIN` | Sentry DSN for the admin dashboard → `VITE_SENTRY_DSN` |
| `SENTRY_AUTH_TOKEN` | Sentry auth token — only needed to upload source maps at build time (org:project scoped). Not required for error capture. |

Sentry DSNs are **per-environment** — staging and production must use distinct DSNs
(execution rule 2). The DSN is a public client key (safe in the bundle); the
`SENTRY_AUTH_TOKEN` is the real secret and is build-time only.

### Monitoring / Alertmanager (Kubernetes secrets, NOT GitHub Actions)

Created in the `monitoring` namespace; referenced by `deploy/monitoring/`.

| Secret | Description |
|---|---|
| `grafana-admin` | Grafana admin user/password (`admin-user`, `admin-password` keys) |
| `alertmanager-pagerduty` | PagerDuty integration key for critical pages |
| `alertmanager-slack` | Slack incoming-webhook URL for warnings |
| `uptime-checker-webhook` | Optional webhook the uptime CronJob hits after 3 failures |

## Notes

- `KUBECONFIG_*` files should be scoped to the minimum required namespace — avoid
  cluster-admin kubeconfigs in CI.
- Rotate `JWT_SECRET_KEY` with zero downtime by running two gateways in parallel
  during the rotation window (old + new key both accepted).
- The iOS signing certificate expires annually — add a calendar reminder to renew
  at least two weeks before expiry to avoid blocking releases.
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` uses a service account with "Release manager"
  role scoped to the single app (not full Play Console access).
