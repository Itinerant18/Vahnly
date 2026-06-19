# Hosting Vahnly on a single GCP VM (docker-compose)

The cheapest way to get the **whole backend** publicly hosted on the GCP **$300 free
trial**. It runs the existing `docker-compose.yml` (Postgres+PostGIS, Kafka, 6-node Redis
cluster, MinIO, Triton, and all ~11 Go services) on one Compute Engine VM, with **Caddy**
terminating HTTPS in front of the gateway. Frontends are hosted separately (Cloud Run /
Firebase Hosting).

> This is a **demo / staging** topology, not production HA. For production use the Helm
> chart in `deploy/charts/vahnly/` with managed Cloud SQL / Memorystore / Confluent.

---

## 0. Cost expectation (so you don't blow the $300)

| Machine | RAM | ~Cost/mo | Credit lasts | Notes |
| --- | --- | --- | --- | --- |
| `e2-standard-4` | 16 GB | ~$97 | ~3 months | Lean. **Drop Triton** (Option B) or it may OOM. |
| `e2-standard-8` | 32 GB | ~$195 | ~6 weeks | Comfortable. Runs **everything incl. Triton (CPU-only)**. |

GPU is **not** required — the Triton service in compose has no GPU reservation, so it runs
CPU-only. (Free-trial accounts have **0 GPU quota** anyway.)

**Always set a budget alert** (Step 7) before you start.

---

## 1. Prerequisites (on your laptop)

- `gcloud` CLI installed and logged in: `gcloud auth login`
- A GCP project with the **$300 trial billing account** linked
- A **domain** you control (for HTTPS). We'll use `api.example.com` below — replace it.

```bash
# Set these once for the session
export PROJECT_ID="your-gcp-project-id"
export REGION="asia-south1"          # Mumbai; pick the region nearest your users
export ZONE="asia-south1-a"
export VM_NAME="dfu-stack"
export API_DOMAIN="api.example.com"   # the domain that will point at this VM

gcloud config set project "$PROJECT_ID"
gcloud services enable compute.googleapis.com
```

---

## 2. Create the network, static IP, and VM

```bash
# Reserve a static external IP (so your domain keeps pointing at the VM across reboots)
gcloud compute addresses create "${VM_NAME}-ip" --region "$REGION"
export VM_IP=$(gcloud compute addresses describe "${VM_NAME}-ip" --region "$REGION" --format='value(address)')
echo "VM IP = $VM_IP   ->   create a DNS A record: $API_DOMAIN -> $VM_IP"

# Firewall: only SSH + HTTP/HTTPS are public. The app ports (8085/8089/gRPC) stay
# internal and are reached through Caddy on 443.
gcloud compute firewall-rules create "${VM_NAME}-web" \
  --allow=tcp:22,tcp:80,tcp:443 \
  --target-tags="${VM_NAME}" \
  --description="SSH + HTTP/HTTPS for Vahnly demo"

# The VM. e2-standard-4 = lean (drop Triton); e2-standard-8 = runs everything.
gcloud compute instances create "$VM_NAME" \
  --zone="$ZONE" \
  --machine-type="e2-standard-4" \
  --image-family="ubuntu-2204-lts" \
  --image-project="ubuntu-os-cloud" \
  --boot-disk-size="60GB" \
  --boot-disk-type="pd-balanced" \
  --address="$VM_IP" \
  --tags="$VM_NAME"
```

Now create the DNS **A record** `$API_DOMAIN -> $VM_IP` at your registrar before Step 6
(Caddy needs it to issue the TLS cert).

SSH in:

```bash
gcloud compute ssh "$VM_NAME" --zone "$ZONE"
```

---

## 3. Install Docker + Compose (on the VM)

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker   # apply group without re-login
```

---

## 4. Clone the repo and create `.env` (on the VM)

```bash
git clone https://github.com/Itinerant18/Vahnly.git
cd Vahnly

# Generate the boot-critical secrets. The gateway REFUSES to boot without these.
# Any length is accepted (each is hashed to a 32-byte key internally).
cat > .env <<EOF
JWT_SECRET_SIGNING_KEY=$(openssl rand -hex 32)
FIELD_ENCRYPTION_KEY=$(openssl rand -base64 32)

# CORS allow-list — your frontend origins, comma-separated, NO wildcard in prod.
ALLOWED_ORIGINS=https://admin.example.com,https://rider.example.com,https://driver.example.com

# Dev fallback so KYC uploads don't require real S3 for a demo. Set false + configure
# S3/GCS for production.
ALLOW_LOCAL_OBJECT_STORE=true
EOF

chmod 600 .env
```

> The internal Postgres/Redis/Kafka addresses are already hard-wired in
> `docker-compose.yml` (`spatial-db`, `redis-node-1`, `kafka-broker`) and the DB password
> defaults to `password` on the **internal** network (not publicly exposed). Change it in
> `docker-compose.yml` if you need real isolation.

---

## 5. Override file: wire the analytics SSE proxy (and, optionally, drop Triton)

Create `docker-compose.override.yml` (auto-merged by compose):

```yaml
services:
  # Point the gateway's heatmap SSE reverse-proxy at the analytics service so the admin
  # dashboard can reach it same-origin through the gateway (matches deploy SYNC-005).
  public-gateway:
    environment:
      - ANALYTICS_SSE_URL=http://spatial-analytics:8089

  # ---- OPTION B (lean / e2-standard-4 only): stub Triton so the box doesn't OOM. ----
  # matching-engine hard-depends on triton being "healthy", so we can't just remove it —
  # we replace it with a tiny stub that passes the health check. ML-based ETA correction
  # is then disabled and the engine falls back to its heuristic ETA.
  # NOTE: verify dispatch/matching still behaves acceptably for your demo before relying
  # on this. To keep real Triton instead (recommended on e2-standard-8), DELETE this block.
  triton-server:
    image: python:3.11-alpine
    command: ["sh", "-c", "python -m http.server 8000"]
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8000/ >/dev/null 2>&1 || exit 1"]
      interval: 5s
      timeout: 5s
      retries: 5
```

On **e2-standard-8** keep real Triton (CPU-only): delete the `triton-server` block above
and leave only the `public-gateway` override.

Bring the stack up (the `db-migrator` runs migrations first, then services start):

```bash
docker compose up -d
docker compose ps            # wait until gateway + analytics are healthy
docker compose logs -f public-gateway | head -50
```

The gateway is now on `http://localhost:8085` inside the VM (container port 8080).

---

## 6. Caddy: HTTPS reverse-proxy in front of the gateway

Caddy auto-provisions a Let's Encrypt cert for `$API_DOMAIN` and proxies HTTP, **WebSocket**
(rider/driver streams), and **SSE** (admin heatmap, via the gateway proxy) — no extra config
needed for those, Caddy streams them transparently.

```bash
# Install Caddy on the VM
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

Write `/etc/caddy/Caddyfile` (replace the domain):

```caddyfile
api.example.com {
 encode zstd gzip
 # All API + WebSocket (/ws/*, /api/v1/dispatch/stream) + the admin heatmap SSE
 # (/api/v1/analytics/heatmap, proxied by the gateway) go to the gateway.
 reverse_proxy localhost:8085 {
  flush_interval -1          # don't buffer SSE/streaming responses
 }
}
```

```bash
sudo systemctl reload caddy
curl -s https://api.example.com/api/v1/config/flags   # should return JSON over HTTPS
```

> gRPC/gRPC-web (driver GPS ingestion) is a separate concern: browser gRPC-web needs an
> Envoy/grpc-web shim. The WebSocket + REST realtime flows work without it; add a gRPC-web
> proxy later if you need browser→gRPC telemetry.

---

## 7. Budget alert (do this now)

```bash
# Find your billing account id
gcloud billing accounts list
export BILLING_ACCOUNT="XXXXXX-XXXXXX-XXXXXX"

gcloud billing budgets create \
  --billing-account="$BILLING_ACCOUNT" \
  --display-name="dfu-trial-budget" \
  --budget-amount=250USD \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0
```

---

## 8. Frontends (host separately — cheap/free)

Build each app pointing at `https://$API_DOMAIN`. Use these env vars (names taken from the
codebase):

**Admin dashboard (`frontend/`, Vite)** → static build → **Firebase Hosting** or a **GCS
bucket** (effectively free):

```
VITE_API_BASE_URL=https://api.example.com
VITE_WS_BASE_URL=wss://api.example.com
VITE_ANALYTICS_URL=https://api.example.com        # served via the gateway SSE proxy
VITE_GOOGLE_MAPS_API_KEY=...                        # your Maps key
```

**Rider app (`rider-app/`, Next.js)** and **Driver app (`client-app/`, Next.js)** →
**Cloud Run** (has a free tier; one container each):

```
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_WS_URL=wss://api.example.com
NEXT_PUBLIC_API_GATEWAY=https://api.example.com
NEXT_PUBLIC_WS_GATEWAY=wss://api.example.com
NEXT_PUBLIC_ANALYTICS_URL=https://api.example.com
```

Example Cloud Run deploy for the rider app (run from `rider-app/`):

```bash
gcloud run deploy dfu-rider \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars="NEXT_PUBLIC_API_URL=https://api.example.com,NEXT_PUBLIC_WS_URL=wss://api.example.com"
```

Whatever frontend origins you use must match the `ALLOWED_ORIGINS` you set in `.env` (Step 4).

---

## 9. Common gotchas

- **Gateway won't boot** → missing `JWT_SECRET_SIGNING_KEY` or `FIELD_ENCRYPTION_KEY`. Check `.env` (Step 4).
- **Admin map blank** → `ANALYTICS_SSE_URL` not set on the gateway (Step 5) or `VITE_ANALYTICS_URL` not pointing at the gateway.
- **CORS errors** → frontend origin missing from `ALLOWED_ORIGINS`.
- **VM OOM / containers restarting** → you're on `e2-standard-4` with real Triton. Use Option B's stub or resize to `e2-standard-8` (`gcloud compute instances set-machine-type`).
- **TLS cert fails** → the DNS A record `$API_DOMAIN -> $VM_IP` isn't live yet; wait for propagation, then `sudo systemctl reload caddy`.
- **Stop billing** when idle: `gcloud compute instances stop "$VM_NAME" --zone "$ZONE"` (you still pay for the disk + static IP, but not vCPU/RAM).

---

## 10. Teardown (stop all charges)

```bash
gcloud compute instances delete "$VM_NAME" --zone "$ZONE" --quiet
gcloud compute addresses delete "${VM_NAME}-ip" --region "$REGION" --quiet
gcloud compute firewall-rules delete "${VM_NAME}-web" --quiet
```
