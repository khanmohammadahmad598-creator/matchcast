#!/usr/bin/env bash
# Backend entrypoint: run migrations (idempotent), seed on first boot, start.
set -euo pipefail

cd /app/backend

echo "[backend] Applying database migrations..."
npx prisma migrate deploy --schema=/app/backend/prisma/schema.prisma

if [ "${SKIP_SEED:-false}" != "true" ]; then
  echo "[backend] Seeding demo data (set SKIP_SEED=true to disable)..."
  npx tsx /app/backend/prisma/seed.ts || echo "[backend] Seed skipped/failed - continuing"
fi

echo "[backend] Starting API on :${PORT:-4000}"
exec node /app/backend/dist/index.js
