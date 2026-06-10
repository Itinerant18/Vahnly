FROM golang:alpine AS builder

# Install system dependencies required for static compilation extensions
RUN apk add --no-cache git ca-certificates build-base

WORKDIR /app

# Leverage Docker layer caching by copying go.mod/go.sum first
COPY go.mod go.sum ./
RUN go mod download

# Copy the remaining project workspace source paths
COPY . .

# Create directory for local upload fallback and set ownership to unprivileged user
RUN mkdir -p /app/public/uploads && chown -R 10001:10001 /app/public/uploads

# Accept a build-time argument specifying which target microservice binary to compile
ARG TARGET_SERVICE

# Compile statically linked binaries with CGO enabled (required for h3-go) and debug tables stripped
RUN CGO_ENABLED=1 GOOS=linux go build \
    -ldflags="-s -w -linkmode external -extldflags '-static'" \
    -o /app/service_binary \
    ./cmd/${TARGET_SERVICE}/main.go

# ═══════════════════════════════════════════════════
# STAGE 2: ULTRA-LIGHTWEIGHT SECURE RUNTIME
# ═══════════════════════════════════════════════════
FROM scratch AS runner

# Import security certificates from the builder stage
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

# Import migration SQL files — consumed by the db-migrator (cmd/migrate) one-shot and by
# the dispatch service's startup AutoRunDatabaseMigrations call.
COPY --from=builder /app/database /database

# Import the compiled static artifact cleanly
COPY --from=builder /app/service_binary /entrypoint

# Copy the uploads directory with correct unprivileged ownership
COPY --from=builder --chown=10001:10001 /app/public/uploads /public/uploads

# Run as an unprivileged secure user boundary (UID 10001) instead of root
USER 10001:10001

EXPOSE 50051 8080

ENTRYPOINT ["/entrypoint"]
