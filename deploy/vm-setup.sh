#!/bin/bash
set -e

echo "==> Step 3: Installing Docker..."
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
echo "[OK] Docker installed: $(docker --version)"

echo "==> Step 4: Cloning repo..."
if [ ! -d "Vahnly" ]; then
  git clone https://github.com/Itinerant18/Vahnly.git
fi
cd Vahnly

echo "==> Step 4: Creating .env..."
cat > .env <<EOF
JWT_SECRET_SIGNING_KEY=$(openssl rand -hex 32)
FIELD_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
ALLOWED_ORIGINS=https://drivers-for-u-app.web.app,https://drivers-for-u-app.firebaseapp.com,https://dfu-rider-app.web.app,https://dfu-driver-app.web.app
ALLOW_LOCAL_OBJECT_STORE=true
EOF
chmod 600 .env
echo "[OK] .env created"

echo "==> Step 5: Creating docker-compose.override.yml (Option B - stub Triton for e2-standard-4)..."
cat > docker-compose.override.yml <<'OVERRIDE'
services:
  public-gateway:
    environment:
      - ANALYTICS_SSE_URL=http://spatial-analytics:8089
  triton-server:
    image: python:3.11-alpine
    command: ["sh", "-c", "python -m http.server 8000"]
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8000/ >/dev/null 2>&1 || exit 1"]
      interval: 5s
      timeout: 5s
      retries: 5
OVERRIDE
echo "[OK] docker-compose.override.yml created"

echo "==> Step 5: Starting the stack (this may take 5-10 min on first run)..."
sudo docker compose up -d
echo "[OK] Stack started. Checking status..."
sudo docker compose ps

echo "==> Step 6: Installing Caddy..."
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update -y
sudo apt-get install -y caddy

echo "==> Writing Caddyfile (HTTP only for now - add your domain later for HTTPS)..."
sudo tee /etc/caddy/Caddyfile > /dev/null <<'CADDY'
:80 {
    encode zstd gzip
    reverse_proxy localhost:8085 {
        flush_interval -1
    }
}
CADDY
sudo systemctl reload caddy

echo ""
echo "==========================================="
echo " Setup complete!"
echo " Gateway: http://8.231.78.88/health"
echo " Add your domain A record -> 8.231.78.88"
echo " Then update Caddyfile with your domain"
echo " for automatic HTTPS via Let's Encrypt"
echo "==========================================="
