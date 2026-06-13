#!/usr/bin/env bash
# Create the object-storage buckets used by the platform against a running MinIO.
# Usage: scripts/init-minio.sh  (defaults target the docker-compose MinIO)
set -euo pipefail

MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
MINIO_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_PASS="${MINIO_ROOT_PASSWORD:-minioadmin123}"

if ! command -v mc >/dev/null 2>&1; then
  echo "minio client 'mc' not found. Install: https://min.io/docs/minio/linux/reference/minio-mc.html" >&2
  exit 1
fi

mc alias set dfu "$MINIO_ENDPOINT" "$MINIO_USER" "$MINIO_PASS"

for bucket in documents trip-photos rider-documents support-attachments; do
  mc mb -p "dfu/${bucket}" || true
  echo "bucket ready: ${bucket}"
done

echo "MinIO buckets initialized."
