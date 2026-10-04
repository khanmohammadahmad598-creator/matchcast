#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Deploy (or upgrade) MatchCast on a Linux VPS using the container images that
# GitHub Actions published to ghcr.io - no source code, no npm, no build step
# on the server.
#
#   curl -fsSL https://raw.githubusercontent.com/khanmohammadahmad598-creator/matchcast/main/scripts/deploy-vps.sh | bash
#
# ...or from a clone:
#
#   ./scripts/deploy-vps.sh
#
# Environment overrides:
#   DEPLOY_PATH=/opt/matchcast   where the stack lives
#   TAG=main                     image tag (main | sha-xxxxxxx | v1.2.3)
#   IMAGE_REPO=ghcr.io/...       image namespace
#   GHCR_TOKEN=ghp_...           only needed while the packages are private
#
# Safe to re-run: it pulls newer images and restarts changed containers.
# ---------------------------------------------------------------------------

set -euo pipefail

REPO="${IMAGE_REPO:-ghcr.io/khanmohammadahmad598-creator/matchcast}"
TAG="${TAG:-main}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/matchcast}"
BRANCH="${BRANCH:-main}"
RAW="https://raw.githubusercontent.com/khanmohammadahmad598-creator/matchcast/${BRANCH}"

info() { printf '\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m  !! %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 0. preflight
info "Preflight"
command -v docker >/dev/null 2>&1 || die "Docker is not installed. See docs/DEPLOYMENT.md §1."
docker compose version >/dev/null 2>&1 || die "The Docker Compose v2 plugin is missing (docker compose version)."
ok "docker $(docker version --format '{{.ServerVersion}}' 2>/dev/null || echo '?')"
ok "compose $(docker compose version --short 2>/dev/null || echo '?')"

if [ "$(id -u)" = "0" ]; then
  ok "running as root"
else
  docker info >/dev/null 2>&1 || die "This user cannot talk to the Docker daemon. Add it to the docker group (sudo usermod -aG docker \$USER, then re-login) or run with sudo."
  ok "docker reachable as $(id -un)"
fi

# ------------------------------------------------------- 1. stage compose files
info "Staging stack in ${DEPLOY_PATH}"
mkdir -p "${DEPLOY_PATH}"
cd "${DEPLOY_PATH}"

if [ -f ../docker-compose.yml ] || [ -f docker-compose.yml ]; then
  ok "using the compose files from this checkout"
else
  for f in docker-compose.yml docker-compose.prod.yml docker-compose.deploy.yml .env.example; do
    curl -fsSL "${RAW}/${f}" -o "${f}" || die "Could not download ${f} from GitHub."
    ok "downloaded ${f}"
  done
fi

# A clone keeps the compose files in the repo root; a download puts them here.
ROOT="."
[ -f docker-compose.yml ] || ROOT=".."
[ -f "${ROOT}/docker-compose.yml" ] || die "docker-compose.yml not found in ${DEPLOY_PATH} or its parent."
[ -f "${ROOT}/docker-compose.deploy.yml" ] || die "docker-compose.deploy.yml not found (upgrade your checkout)."

# ------------------------------------------------------------------- 2. secrets
if [ ! -f .env ]; then
  info "Creating .env"
  cp "${ROOT}/.env.example" .env
  rand() { (command -v openssl >/dev/null && openssl rand -hex 32) || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(rand)|" .env
  sed -i "s|^WORKER_TOKEN=.*|WORKER_TOKEN=$(rand)|" .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rand | head -c 24)|" .env 2>/dev/null || true
  sed -i "s|^DEFAULT_ADMIN_PASSWORD=.*|DEFAULT_ADMIN_PASSWORD=ChangeMeNow123!|" .env
  chmod 600 .env
  ok ".env created with fresh random secrets - CHANGE THE ADMIN PASSWORD after the first login"
else
  ok ".env already present (left untouched)"
fi

grep -q '^JWT_SECRET=.\{16,\}' .env || die "JWT_SECRET is missing or too short in ${DEPLOY_PATH}/.env"
grep -q '^WORKER_TOKEN=.\{16,\}' .env || die "WORKER_TOKEN is missing or too short in ${DEPLOY_PATH}/.env"

# ------------------------------------------------------------------- 3. registry
if [ -n "${GHCR_TOKEN:-}" ]; then
  info "Logging in to ghcr.io"
  printf '%s' "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER:-github}" --password-stdin >/dev/null
  ok "authenticated (private packages)"
else
  ok "no GHCR_TOKEN - pulling the packages anonymously (they must be public)"
fi

# --------------------------------------------------------------- 4. pull + start
export IMAGE_REPO="${REPO}" TAG="${TAG}"

info "Pulling ${REPO}-*:${TAG}"
docker compose -f "${ROOT}/docker-compose.yml" -f "${ROOT}/docker-compose.prod.yml" -f "${ROOT}/docker-compose.deploy.yml" pull

info "Starting the stack"
docker compose -f "${ROOT}/docker-compose.yml" -f "${ROOT}/docker-compose.prod.yml" -f "${ROOT}/docker-compose.deploy.yml" up -d --remove-orphans

# -------------------------------------------------------------- 5. health check
info "Waiting for the API to become healthy"
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
    ok "API is up"; break
  fi
  sleep 3
done
curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1 || {
  echo "--- backend log ---"
  docker compose -f "${ROOT}/docker-compose.yml" -f "${ROOT}/docker-compose.prod.yml" -f "${ROOT}/docker-compose.deploy.yml" logs --tail 60 backend || true
  die "The API never became healthy. Log output above."
}

docker compose -f "${ROOT}/docker-compose.yml" -f "${ROOT}/docker-compose.prod.yml" -f "${ROOT}/docker-compose.deploy.yml" ps

cat <<EOF

  MatchCast is running from the published images (tag: ${TAG}).

    dashboard   http://127.0.0.1:8080   (put it behind TLS - docs/DEPLOYMENT.md §4)
    api         http://127.0.0.1:4000

  Next:
    1. point your domain at this box and add the reverse proxy
    2. log in with the admin from .env and change the password
       (Dashboard header -> Password, or POST /api/auth/change-password)
    3. set YOUTUBE_STREAM_KEY in ${DEPLOY_PATH}/.env, then:
         cd ${DEPLOY_PATH} && docker compose up -d
    4. upgrade later: re-run this script with TAG=<new tag>

EOF
