#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# First-time setup for local development (no Docker required):
#   bash scripts/setup.sh
#
# Prerequisites: Node 20+, PostgreSQL, Redis, FFmpeg.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> 1/6 Installing workspace dependencies"
npm install

echo "==> 2/6 Building @matchcast/shared"
npm run build -w @matchcast/shared

echo "==> 3/6 Generating Prisma client"
npm run prisma:generate -w @matchcast/backend

echo "==> 4/6 Running database migrations"
npm run db:migrate -w @matchcast/backend

echo "==> 5/6 Seeding demo data (admin user, graphics templates, demo match)"
npm run db:seed -w @matchcast/backend

echo "==> 6/6 Generating the demo video asset"
bash scripts/make-demo-asset.sh 30

cat <<'TXT'

Setup complete.

Start everything (4 terminals, or use `npm run dev` for all-in-one):

  npm run dev:backend      # control plane on :4000
  npm run dev:graphics     # scoreboard renderer
  npm run dev:stream       # ffmpeg pipeline
  npm run dev:web          # dashboard on :5173

Then open http://localhost:5173 and sign in with
  admin@matchcast.local / ChangeMeNow123!

For a scripted end-to-end demo, run:
  bash scripts/demo.sh
TXT
