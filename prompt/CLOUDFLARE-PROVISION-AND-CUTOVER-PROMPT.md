# Vahnly → Cloudflare: provision, deploy, cut over

> Paste below the line into a fresh Claude Code session at repo root.
> Prerequisite: code phase is done (see `prompt/CLOUDFLARE-MIGRATION-PROMPT.md`, `DOC/ADR-cloudflare-migration.md`).
> This prompt does the live-resource phase. It touches production DNS and data. Every step has a check; do not skip checks.

---

You are finishing the Cloudflare migration for Vahnly. Code is written and typechecks (`workers/api`, `workers/cron`, three frontends with `wrangler.toml`). Remote KV `VAHNLY_CONFIG` and Queues `vahnly-domain-events` / `vahnly-domain-events-dlq` already exist. Everything is uncommitted on `main`. Your job: provision the remaining resources, deploy, migrate data, cut DNS over, and commit. Stop and ASK only at the points marked ASK.

## Facts

- Cloudflare account id `b990b084ebfb02cc579579d1db1cfb95`; `wrangler` is logged in via OAuth (`npx wrangler whoami`).
- Zone `aniket.site` DNS currently lives on **Netlify DNS**, not the registrar. Full export is in `DOC/aniket-site-dns-backup.json` (11 records). Non-Vahnly things live there: root + `www` → Netlify site, `serendipity.aniket.site` → another Netlify site, Resend email (`resend._domainkey` TXT, `rsend` + `send` CNAMEs, `_dmarc` TXT). `api.aniket.site` is an A record to the GCP VM `35.244.47.44`. `rider`/`driver`/`admin` are CNAMEs to `*.web.app`.
- Prod backend today: GCP VM `dfu-stack` (project `vahnly-platform`, zone `asia-south1-c`), Docker Compose, Postgres container `spatial_postgres_dev`, db `delivery_platform`. Memory note "Prod DB access" has the psql-via-base64 procedure. Keep the VM running until the end of this prompt and beyond (7-day soak).
- Firebase project `vahnly-platform` stays for Auth + FCM. Firebase Hosting sites `vahnly-rider`, `vahnly-driver`, `vahnly-platform` get disabled only after the soak.
- Neon connection string: read from `workers/api/.dev.vars` key `NEON_DATABASE_URL` (pooled host, `-pooler`). Never print it. If the file or key is missing, STOP and ask the user to add it.
- Migrations: 202 files in `database/migrations`, golang-migrate format. CLI: `migrate` (install via `go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest` if missing) or `go run ./cmd/migrate` with `DATABASE_URL`.
- Free-tier caps and the capacity math are in `DEPLOYMENT.md`; do not upgrade any plan.

## Step 0 — Preflight (all must pass before anything else)

```
npx wrangler whoami                       # account b990b084...
npx wrangler r2 bucket list               # must NOT return error 10042; if it does, R2 is not enabled → STOP, ask user to click Enable R2 in dashboard
npx wrangler kv namespace list            # VAHNLY_CONFIG present
npx wrangler queues list                  # both queues present
test -f workers/api/.dev.vars && grep -q NEON_DATABASE_URL workers/api/.dev.vars
psql "$NEON_DATABASE_URL" -c "select postgis_version();"   # PostGIS enabled on Neon; if not: CREATE EXTENSION IF NOT EXISTS postgis;
cd workers/api && npx tsc --noEmit && cd ../cron && npx tsc --noEmit
git status --short                        # note what is uncommitted; do not discard anything
```

## Step 1 — Commit the code phase first

One commit, so the provisioning steps have a clean base to diff against:

```
git add workers .github/workflows/cf-deploy-api.yml .github/workflows/cf-deploy-web.yml \
  .github/workflows/deploy.yml .github/workflows/vm-deploy.yml .gitignore DEPLOYMENT.md \
  DOC/ADR-cloudflare-migration.md DOC/aniket-site-dns-backup.json \
  rider-app/wrangler.toml rider-app/public/_headers \
  client-app/wrangler.toml client-app/public/_headers client-app/public/_redirects \
  frontend/wrangler.toml frontend/public/_headers prompt/
git commit -m "feat(infra): Cloudflare Workers migration — API/cron workers, static-asset frontends, CI"
```

Do NOT add `.dev.vars`, `google-services.json` changes, or the Android gradle/`build_android.ps1` changes; those are unrelated and stay uncommitted. Confirm `.gitignore` covers `**/.dev.vars` and `workers/*/dist`.

## Step 2 — R2

```
npx wrangler r2 bucket create vahnly-documents
```

CORS (save as `workers/api/r2-cors.json`, then `npx wrangler r2 bucket cors set vahnly-documents --file workers/api/r2-cors.json`):

```json
[{"AllowedOrigins":["https://driver.aniket.site","https://rider.aniket.site","https://admin.aniket.site"],
  "AllowedMethods":["GET","PUT","HEAD"],"AllowedHeaders":["*"],"MaxAgeSeconds":3600}]
```

Copy existing objects from the VM's MinIO. On the VM (`gcloud compute ssh dfu-stack --zone asia-south1-c`): install rclone, `rclone config` remote `minio` (S3, endpoint `http://localhost:9000`, `minioadmin`/`minioadmin123`) and remote `r2` (S3, provider Cloudflare, endpoint `https://b990b084ebfb02cc579579d1db1cfb95.r2.cloudflarestorage.com`, an R2 API token created in dashboard → R2 → Manage API tokens, Object Read & Write, scoped to `vahnly-documents`). Then for each of `documents trip-photos rider-documents support-attachments`: `rclone sync minio:<b> r2:vahnly-documents/<b> --progress`. Check: `npx wrangler r2 object list vahnly-documents --prefix documents/ | head`. If MinIO on the VM is empty, say so and skip.

Delete the R2 API token after the copy; the Worker uses the binding, not keys.

## Step 3 — Neon schema + data

1. `migrate -path database/migrations -database "$NEON_DATABASE_URL" up`. Check: `psql ... -c "select version from schema_migrations;"` = 202 (or the highest file number), `dirty = f`. If a migration fails on Neon, read it, fix forward with a new numbered migration, never edit an old file.
2. Data snapshot from the VM. On the VM:
   ```
   docker exec spatial_postgres_dev pg_dump -U postgres -d delivery_platform \
     --data-only --no-owner --no-privileges --disable-triggers \
     --exclude-table='driver_location*' --exclude-table='telemetry*' --exclude-table='*_history' \
     -f /tmp/vahnly-data.sql
   ```
   Inspect table list first (`\dt`) and adjust excludes so the file stays under ~300 MB (Neon free = 0.5 GB). `gcloud compute scp` it down, then `psql "$NEON_DATABASE_URL" -v ON_ERROR_STOP=1 -f vahnly-data.sql`. Check row counts on 5 core tables (`orders`, `drivers`, `riders`, `ledger*`, `regional_cities`) match between VM and Neon.
3. Rewrite object URLs: one new migration `000203_r2_document_keys.up.sql` that turns `http://minio:9000/documents/<key>` (and any `http://localhost:9000/...`) into the bare key `documents/<key>` in every `*_url` column that holds them. Find the columns with `grep -rn "minio" database/migrations internal | grep -i url` first. Apply it.
4. Note the Neon DB size: `select pg_size_pretty(pg_database_size(current_database()));` → write it into `DEPLOYMENT.md` capacity section.

## Step 4 — Hyperdrive

```
npx wrangler hyperdrive create vahnly-pg    --connection-string="$NEON_DATABASE_URL" --caching-max-age=60
npx wrangler hyperdrive create vahnly-pg-rw --connection-string="$NEON_DATABASE_URL" --caching-disabled
```

Put both ids into `workers/api/wrangler.toml` (`HYPERDRIVE`, `HYPERDRIVE_RW`) and `workers/cron/wrangler.toml`. Check: `npx wrangler hyperdrive list` shows 2.

## Step 5 — Secrets and vars

For `workers/api` (and the subset `workers/cron` needs), `npx wrangler secret put <NAME>` for each:
`JWT_SECRET_SIGNING_KEY`, `FIELD_ENCRYPTION_KEY`, `GOOGLE_OAUTH_CLIENT_SECRET`, `APPLE_OAUTH_PRIVATE_KEY`, `FCM_SERVICE_ACCOUNT_JSON` (contents of the FCM service-account file from the VM's `./firebase` dir or `FCM_SERVICE_ACCOUNT_HOST_DIR`), `GOOGLE_MAPS_API_KEY`, `PAYMENT_WEBHOOK_SIGNING_SECRET`, `SENTRY_DSN`.

Values come from the VM's `/home/itine/Vahnly/.env` (read with `ssh`, never paste into chat or files). `JWT_SECRET_SIGNING_KEY` and `FIELD_ENCRYPTION_KEY` MUST be the same values as the VM or existing tokens and encrypted rows break.

Plain vars go in `wrangler.toml [vars]`: `ACCESS_TOKEN_TTL=4h`, `ALLOWED_ORIGINS=https://rider.aniket.site,https://driver.aniket.site,https://admin.aniket.site`, `ADMIN_FRONTEND_URL=https://admin.aniket.site`, `ADMIN_COOKIE_SAMESITE`, `FIREBASE_PROJECT_ID=vahnly-platform`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_REDIRECT_URL=https://api.aniket.site/...` (copy path from VM env), `CITY_PREFIX=KOL`, `SURGE_TRACKED_CELLS`, `SUPPORTED_REGIONS_MATRIX`, `APP_VERSION`, `OSRM_BASE_URL`, `NOMINATIM_BASE_URL` if set on VM.

Check: `npx wrangler secret list` in each worker dir shows every name above.

## Step 6 — Deploy Workers to `workers.dev` first (no custom domain yet)

Temporarily comment out the `routes` block in `workers/api/wrangler.toml`, deploy, and smoke against the `*.workers.dev` URL:

```
cd workers/api && npx wrangler deploy
curl -sf https://vahnly-api.<subdomain>.workers.dev/health
curl -sf https://vahnly-api.<subdomain>.workers.dev/api/v1/config/flags
cd ../cron && npx wrangler deploy && npx wrangler tail vahnly-cron --format pretty   # wait for one scheduled run, outcome ok
```

Then run the API test procedure from memory note "Dispatch verified" against the workers.dev URL (login → driver online → create order → offer via WebSocket). Use `wss://` on the workers.dev host. Fix anything that fails here before touching DNS. Check `npx wrangler tail vahnly-api` for `cpuTime` > 10 ms on any route and fix by moving work into `ctx.waitUntil`.

## Step 7 — Frontends to `workers.dev`

For each of `rider-app`, `client-app`, `frontend`: set the API/WS env to the workers.dev API URL for this test build only, `npm run build`, comment out `routes`, `npx wrangler deploy`. Open each `*.workers.dev` URL. Check: SPA deep link loads (`/driver-account/refer/` on driver), `_headers` present (`curl -sI ... | grep -i x-frame`), driver redirect `/driver/account/referrals` → 301.

Phone-OTP login will fail here because `*.workers.dev` is not a Firebase authorized domain; that is expected. Do not add workers.dev to Firebase.

## Step 8 — Cloudflare zone for `aniket.site` (ASK before Step 8.4)

1. Dashboard or API: add zone `aniket.site`, Free plan. Get the two assigned nameservers.
2. Import all 11 records from `DOC/aniket-site-dns-backup.json` via API (`POST /zones/{id}/dns_records`, token from `wrangler` OAuth is not usable here; create an API token "Zone DNS Edit" for `aniket.site`, store it only in the shell for this session). Rules:
   - `aniket.site`, `www`, `serendipity` CNAMEs: **proxied = false** (Netlify terminates TLS).
   - `rsend`, `send` CNAMEs and both TXT: proxied = false.
   - `api` A `35.244.47.44`: proxied = false for now (Caddy on the VM does its own Let's Encrypt; proxying would break the ACME HTTP challenge).
   - `rider`, `driver`, `admin` CNAMEs to `*.web.app`: proxied = false.
3. Check with the Cloudflare nameservers directly before switching: `dig @<ns1> serendipity.aniket.site CNAME +short`, `dig @<ns1> resend._domainkey.aniket.site TXT +short`, `dig @<ns1> api.aniket.site A +short`. All 11 must resolve identically to `dig @dns1.p01.nsone.net` (Netlify's NS).
4. **ASK the user** to change nameservers at the registrar to the two Cloudflare ones. Do not proceed until `dig NS aniket.site +short` shows Cloudflare. Propagation can take up to 24 h; the imported records keep every existing site working meanwhile.
5. Once active: zone settings → SSL/TLS **Full (strict)**, Always Use HTTPS, HSTS (max-age 31536000, includeSubDomains), TLS 1.2 min, WebSockets on, Brotli on, Bot Fight Mode on. One rate-limiting rule: `api.aniket.site/api/v1/auth/*` 100 req/10 s per IP → block 10 s.
6. Cloudflare Access application for `admin.aniket.site`: Google IdP or one-time PIN, allow-list = admin emails from the `admins` table / user. Free ≤ 50 users.

## Step 9 — Custom domains and cutover

1. Frontends: uncomment `routes` in the three frontend `wrangler.toml`, rebuild with production env (`NEXT_PUBLIC_API_URL=https://api.aniket.site`, `NEXT_PUBLIC_WS_URL=wss://api.aniket.site`, `VITE_API_BASE_URL=https://api.aniket.site`, analytics URL same host), deploy. Cloudflare replaces the `rider`/`driver`/`admin` CNAMEs with Worker custom domains automatically; if it refuses because a record exists, delete that CNAME first.
2. Firebase Console → Authentication → Settings → Authorized domains: add `rider.aniket.site`, `driver.aniket.site` (they were already there if the sites were live on these domains; verify). Google Cloud Console → OAuth client: JS origins + redirect URIs for the three domains and `https://api.aniket.site`.
3. Check rider/driver phone-OTP login and Google login on the real domains. Check FCM token registration (`firebase-messaging-sw.js` served at site root, 200, `Content-Type: application/javascript`).
4. API cutover, at low-traffic time:
   - Take a delta dump on the VM: rows with `updated_at >= '<Step 3 snapshot time>'` for `orders`, ledger tables, `drivers`, `riders`, `notification_outbox`; apply to Neon with `ON CONFLICT DO UPDATE` (write the upsert SQL by hand per table; do not blindly re-run the full dump).
   - Uncomment `routes` in `workers/api/wrangler.toml`, `npx wrangler deploy`. Delete the `api` A record if Cloudflare did not replace it.
   - Smoke: `curl -sf https://api.aniket.site/health`, `.../api/v1/config/flags`, full API test procedure, WebSocket offer, admin heatmap `EventSource`, one real document upload + admin KYC view (R2 path).
5. Set GitHub secrets `CLOUDFLARE_API_TOKEN` (new token: Workers Scripts Edit, Workers KV Edit, Queues Edit, R2 Edit, Hyperdrive Edit, Zone DNS Edit for aniket.site, Account Settings Read), `CLOUDFLARE_ACCOUNT_ID`, `NEON_DATABASE_URL`; GitHub variables for the `NEXT_PUBLIC_*` / `VITE_*` values. Check: push an empty commit touching `workers/api/README.md` → `cf-deploy-api.yml` green; touching `rider-app/README.md` → `cf-deploy-web.yml` green.
6. Remove the `GCP_SA_KEY`-driven auto-deploy: `vm-deploy.yml` must already be `workflow_dispatch`-only; verify.

## Step 10 — Soak and observability (do not decommission yet)

- Workers Logs on for all five Workers (`[observability] enabled = true`), Cloudflare Notifications: "Workers usage approaching daily limit" and "Origin error rate" to the user's email.
- Add `DEPLOYMENT.md` section "Cut over 2026-MM-DD": what is live where, VM still running as rollback (`api-legacy` path: repoint `api` A record to `35.244.47.44`, proxied off), the soak end date (+7 days), and the decommission checklist (disable Firebase Hosting sites, delete VM + static IP, remove `GCP_SA_KEY`, delete `deploy/vm-setup.sh`, `deploy/gcp-vm-setup.md`, `vm-deploy.yml`, `deploy.yml`).
- Commit: `chore(infra): Cloudflare cutover — hyperdrive ids, R2 CORS, migration 000203, DEPLOYMENT notes`.
- `graphify update .`

## Rules

- Never print secrets or the Neon connection string. Read them from files/env, write them with `wrangler secret put`.
- Never flip nameservers yourself; never delete the VM, the Firebase Hosting sites, or the Netlify sites. Those are ASK or out of scope.
- Every `wrangler deploy` is preceded by the check of the previous step passing. If a check fails twice, stop and report exactly what failed with the command output.
- Keep diffs surgical: wrangler ids, one migration, DEPLOYMENT.md notes. No refactors of the Worker code in this session unless a smoke test fails.
