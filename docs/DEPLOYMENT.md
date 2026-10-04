# Production deployment (Linux VPS)

How to run MatchCast 24/7 on a single Linux box: Docker Compose for the stack,
a host reverse proxy for TLS, PostgreSQL backups, and the checks you should do
before pointing it at YouTube.

Local/dev setup lives in [`SETUP.md`](SETUP.md). Compliance rules (what you are
allowed to broadcast) are in [`COMPLIANCE.md`](COMPLIANCE.md) — read that first.

```
                 ┌──────────────────────── host (Ubuntu 22.04/24.04) ───────────────────────┐
   browser ─────▶│ nginx / Caddy :443 ──▶ frontend:80 (nginx, static bundle)                │
      │          │        └─▶ /api, /socket.io, /media ──▶ backend:4000                     │
      │          │                                            │                             │
      │          │   backend:4000 ──▶ postgres (internal) ──▶ redis (internal)              │
      │          │        ▲                 ▲                                               │
      │          │  stream-worker      graphics-worker   (ffmpeg + Skia, shared .runtime)   │
      │          └──────────────────────────────┬───────────────────────────────────────────┘
      │                                         │
      └──── HLS preview (/api/preview/<token>/index.m3u8)      └──▶ YouTube RTMPS :443
```

---

## 0. Sizing the box

| Output | vCPU | RAM | Notes |
| --- | --- | --- | --- |
| 720p30, CPU encoder (`libx264` `veryfast`) | 4 | 8 GB | comfortable, leaves room for the DB |
| 1080p30 | 6–8 | 8–16 GB | CPU encoding gets expensive here |
| 1080p60 | 8 | 16 GB | **use a hardware encoder** (NVENC / VA-API) — see §9 |

Upload bandwidth is the other half of the equation: your bitrate must fit
comfortably (aim for ≤ 60 % of measured sustained upload) or YouTube will report
a “Bad” stream health no matter how good the video is.

```bash
# measure sustained upload before choosing a bitrate
curl -s https://raw.githubusercontent.com/sivel/speedtest-cli/master/speedtest.py | python3 - --simple
```

---

## 1. Install Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git jq
sudo install -m0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"     # re-login afterwards
docker compose version               # v2.x required
```

---

## 2. Get the code and create the environment

```bash
sudo mkdir -p /srv/matchcast && sudo chown "$USER" /srv/matchcast
cd /srv/matchcast
git clone https://github.com/khanmohammadahmad598-creator/matchcast.git .

# Start from the example and then edit it - never commit the real .env
cp .env.example .env
chmod 600 .env
```

Generate the three secrets (do **not** reuse the dev defaults):

```bash
JWT_SECRET=$(openssl rand -hex 32)
WORKER_TOKEN=$(openssl rand -hex 32)
SCORING_API_KEY=$(openssl rand -hex 24)
PREVIEW_TOKEN=$(openssl rand -hex 12)
POSTGRES_PASSWORD=$(openssl rand -hex 24)

python3 - "$PWD/.env" <<PY
import sys, re, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text()
for k, v in {
    'JWT_SECRET': "$JWT_SECRET",
    'WORKER_TOKEN': "$WORKER_TOKEN",
    'SCORING_API_KEY': "$SCORING_API_KEY",
    'PREVIEW_TOKEN': "$PREVIEW_TOKEN",
    'POSTGRES_PASSWORD': "$POSTGRES_PASSWORD",
    'DEFAULT_ADMIN_PASSWORD': "$(openssl rand -hex 12)",
    'ALLOW_ANY_ORIGIN': 'false',
    'CORS_ORIGINS': 'https://matchcast.example.com',
}.items():
    s = re.sub(rf'^{k}=.*$', f'{k}={v}', s, flags=re.M)
p.write_text(s)
print('secrets written to', p)
PY
```

Then open `.env` and set the operational values:

| Key | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `YOUTUBE_RTMP_URL` | `rtmps://a.rtmps.youtube.com/live2` (default) |
| `YOUTUBE_STREAM_KEY` | your key — **only** in `.env`, never in the repo, logs or the browser |
| `CORS_ORIGINS` | your public HTTPS origin |
| `ALLOW_ANY_ORIGIN` | `false` |
| `POSTGRES_*` | must match `DATABASE_URL` (compose builds it for you) |
| `OPENAI_API_KEY` / `ELEVENLABS_API_KEY` / … | optional; without them the offline rule-based commentary engine and tone-based TTS are used |

---

## 2.1 Deploy the published images (no build on the server)

Every push to `main` builds and publishes the production images to GitHub
Container Registry (`.github/workflows/publish.yml`, using the built-in
`GITHUB_TOKEN` — no registry account needed):

| Image | Contents | Tags |
|---|---|---|
| `matchcast-base` | Node 20 + ffmpeg + fonts + built workspace | `main`, `sha-<short>`, `latest`, `vX.Y.Z` |
| `matchcast-backend` | API, Socket.IO, audio mixer, migrations | same |
| `matchcast-stream-worker` | ffmpeg pipeline, replay buffer, TTS playback | same |
| `matchcast-graphics-worker` | scoreboard renderer | same |
| `matchcast-frontend` | nginx serving the dashboard build | same |

They live under `ghcr.io/khanmohammadahmad598-creator/matchcast-*`.

### One command on a fresh VPS

```bash
curl -fsSL https://raw.githubusercontent.com/khanmohammadahmad598-creator/matchcast/main/scripts/deploy-vps.sh | bash
```

The script checks Docker, stages `docker-compose.yml` + `docker-compose.prod.yml`
+ `docker-compose.deploy.yml` in `/opt/matchcast`, generates `.env` with random
`JWT_SECRET` / `WORKER_TOKEN`, pulls the images, starts the stack and waits for
`/api/health`.

### Or by hand

```bash
mkdir -p /opt/matchcast && cd /opt/matchcast
for f in docker-compose.yml docker-compose.prod.yml docker-compose.deploy.yml .env.example; do
  curl -fsSLO "https://raw.githubusercontent.com/khanmohammadahmad598-creator/matchcast/main/$f"
done
cp .env.example .env && $EDITOR .env          # JWT_SECRET, WORKER_TOKEN, passwords

export IMAGE_REPO=ghcr.io/khanmohammadahmad598-creator/matchcast TAG=main
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.deploy.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.deploy.yml up -d
```

`docker-compose.deploy.yml` only overrides the `image:` of each service — every
other setting still comes from the base and prod files, so there is a single
place to change configuration. Because `build:` stays in the merged config, a
host without the images (and with the source checked out) still falls back to
building locally.

### Pinning and rolling back

```bash
TAG=sha-1a2b3c4 ./scripts/deploy-vps.sh     # pin an exact build
TAG=v1.2.0      ./scripts/deploy-vps.sh     # pin a release
```

Always pull a tag, never `latest`, if you want reproducible rollbacks.

### Push-to-deploy (optional)

Add these to **Settings → Secrets and variables → Actions** and every successful
publish SSHes into the box and runs the compose pull/up for you:

| Secret / variable | Value |
|---|---|
| `SSH_HOST` | VPS IP or hostname |
| `SSH_USER` | e.g. `deploy` (needs to be in the `docker` group) |
| `SSH_KEY` | private key (ed25519) whose public half is in `~/.ssh/authorized_keys` |
| `DEPLOY_PATH` (variable, optional) | stack directory, default `/opt/matchcast` |

Without them the workflow simply skips the deploy step and prints a notice —
the images are published either way.

> If the ghcr packages are private, log in once on the server
> (`docker login ghcr.io -u <user> -p <PAT with read:packages>`) or set
> `GHCR_TOKEN` for `deploy-vps.sh`.

---

## 3. Build and start

```bash
cd /srv/matchcast

# The services inherit from this base image (ffmpeg + fonts + built workspace).
docker build -t matchcast/base:latest -f docker/Dockerfile.base .

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

On first boot the backend entrypoint runs `prisma migrate deploy` and seeds the
admin user + graphics templates, so a fresh volume works with no manual steps
(`SKIP_SEED=true` disables the seed).

```bash
docker compose ps                                   # every service should be "healthy"/"running"
docker compose logs -f backend | head -40
curl -fsS http://127.0.0.1:4000/api/system/health    # {"ok":true,"service":"backend","db":"up",...}
```

**Do this immediately:** log in at `https://matchcast.example.com` with
`DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` from `.env` and rotate the
password — **Password** button in the dashboard header, or
`POST /api/auth/change-password` (`{ currentPassword, newPassword }`).

---

## 4. TLS reverse proxy

Never expose `4000`/`8080` directly. Two options — pick one.

### Option A — Caddy (automatic certificates)

`/etc/caddy/Caddyfile`:

```caddyfile
matchcast.example.com {
    encode gzip

    # Socket.IO needs real WebSocket support (no buffering).
    @websockets {
        header Connection *Upgrade*
        header Upgrade    websocket
    }
    reverse_proxy @websockets 127.0.0.1:4000

    handle_path /api/*  { reverse_proxy 127.0.0.1:4000 }
    handle /socket.io/* { reverse_proxy 127.0.0.1:4000 }
    handle /media/*     { reverse_proxy 127.0.0.1:4000 }
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
sudo systemctl reload caddy
```

### Option B — nginx + certbot

```nginx
# /etc/nginx/sites-available/matchcast
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

upstream matchcast_api { server 127.0.0.1:4000; }
upstream matchcast_web { server 127.0.0.1:8080; }

server {
    listen 80;
    server_name matchcast.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name matchcast.example.com;

    ssl_certificate     /etc/letsencrypt/live/matchcast.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/matchcast.example.com/privkey.pem;

    client_max_body_size 8m;   # logo uploads

    location /socket.io/ {
        proxy_pass http://matchcast_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;      # long-lived websocket
        proxy_buffering off;
    }

    location ~ ^/(api|media)/ {
        proxy_pass http://matchcast_api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    location / {
        proxy_pass http://matchcast_web;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/matchcast /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d matchcast.example.com
```

### Firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

Postgres/Redis are bound to `127.0.0.1` by `docker-compose.prod.yml`, so they are
never reachable from the internet.

---

## 5. Pre-flight before going live

Work through this once with the local test target, then switch to YouTube.

```bash
# 1. local RTMP sink instead of YouTube (no key needed)
pkill -f 'listen 1' || true
mkdir -p .runtime
nohup ffmpeg -hide_banner -loglevel error -y -listen 1 -f flv \
      -i rtmp://0.0.0.0:1935/live/test -c copy -f mpegts .runtime/received.ts \
      > .runtime/rtmp-sink.log 2>&1 &

# 2. point the stream-worker at it
echo 'RTMP_TEST_URL=rtmp://127.0.0.1:1935/live/test' >> .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d stream-worker
```

Then in the dashboard: **Streaming → Start**, watch status go `IDLE → CONNECTING → CONNECTED`,
confirm fps/bitrate/uptime, drive a few balls from **Match Control**, and check
that commentary lines show `ttsStatus: PLAYED`. Finally:

```bash
ffplay -fflags nobuffer rtmp://127.0.0.1:1935/live/test     # or
ffplay .runtime/received.ts
```

When you are happy, remove `RTMP_TEST_URL` and set `YOUTUBE_STREAM_KEY`.

---

## 6. YouTube output settings

| Output | Video bitrate | Audio |
| --- | --- | --- |
| 720p30 | 1,500–4,000 kbps | AAC-LC 128 kbps, 48 kHz |
| 720p60 | 2,250–6,000 kbps | AAC-LC 128 kbps |
| 1080p30 | 3,000–6,000 kbps | AAC-LC 128–160 kbps |
| 1080p60 | 4,500–9,000 kbps | AAC-LC 160 kbps |

Sport is high-motion content, so sit at the **upper** end of the range your
upload can sustain. The worker also sets the encoder knobs YouTube expects:
H.264 High profile, **2-second keyframe interval**, CBR with a small buffer, and
`rtmps://a.rtmps.youtube.com/live2` by default [1](https://antmedia.io/video-bitrate/).

Other live-day rules:

- Create the broadcast in YouTube Studio **well before** kick-off (a new stream
  key needs a few minutes to become valid).
- Keep the key in `.env` only. The backend redacts it from every log line, API
  response and ffmpeg argument (`maskTarget()`), so it cannot leak into the
  dashboard or Log pages.
- Watch **YouTube Studio → Stream health**: “Good” means the network and bitrate
  are fine; “Bad” means lower the bitrate before blaming the encoder.
- The stream-worker reconnects with exponential backoff (max
  `MAX_RESTART_BACKOFF_SECONDS`, default 30 s) and the watchdog restarts a
  stalled ffmpeg after `PIPELINE_WATCHDOG_SECONDS` (default 20 s). A network
  blip therefore recovers on its own — do not hit “stop/start” during one.

---

## 7. Backups

```bash
# /srv/matchcast/scripts/backup-db.sh  (chmod +x)
#!/usr/bin/env bash
set -euo pipefail
cd /srv/matchcast
STAMP=$(date +%F-%H%M)
OUT=/srv/matchcast/backups
mkdir -p "$OUT"
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-matchcast}" "${POSTGRES_DB:-matchcast}" | gzip > "$OUT/matchcast-$STAMP.sql.gz"
# keep 14 days
find "$OUT" -name 'matchcast-*.sql.gz' -mtime +14 -delete
echo "backup written: $OUT/matchcast-$STAMP.sql.gz"
```

```bash
sudo crontab -e
# every 6 hours
0 */6 * * * /srv/matchcast/scripts/backup-db.sh >> /var/log/matchcast-backup.log 2>&1
```

Restore:

```bash
gunzip -c backups/matchcast-2026-10-04-0600.sql.gz \
  | docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
      psql -U matchcast -d matchcast
```

The `runtime-data` volume (uploaded logos, TTS cache, replay buffer) is
regenerable except for uploads — back it up with your usual file-level backup,
or store logos in object storage and reference them by URL.

---

## 8. Monitoring

| What | Where |
| --- | --- |
| Liveness (public, no auth) | `GET /api/system/health` → `{"ok":true,"db":"up"}` (503 when the DB is down) |
| Stream status | `GET /api/stream/status` → running, state, fps, kbps, uptime, generation |
| Logs (DB-backed, redacted) | Dashboard → System Logs, or `GET /api/system/logs` |
| Container logs | `docker compose logs -f --tail=200 stream-worker` |
| Live stats over Socket.IO | `system:stats` event every 2 s |

Suggested external checks (Uptime Kuma / Better Stack / cron + curl):

```bash
curl -fsS https://matchcast.example.com/api/system/health || echo "backend DOWN"
# during a broadcast, also assert the stream is actually connected
curl -fsS -H "authorization: Bearer $TOKEN" https://matchcast.example.com/api/stream/status \
  | jq -e '.status.running and .status.state == "CONNECTED"' > /dev/null || echo "stream DOWN"
```

---

## 9. Hardware encoding

CPU encoding is the default and always works. For 1080p60, offload it:

**NVIDIA NVENC** — install the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html),
then uncomment the `deploy.resources.reservations.devices` block under
`stream-worker` in `docker-compose.prod.yml` and set `HW_ACCEL=nvidia`.

**Intel/AMD VA-API** — uncomment `devices: - /dev/dri:/dev/dri` and set
`HW_ACCEL=vaapi`. Confirm the host exposes it:

```bash
ls /dev/dri && vainfo | head -5
docker compose exec stream-worker ffmpeg -hide_banner -encoders 2>/dev/null | grep -E 'h264_(nvenc|vaapi|qsv)'
```

`HW_ACCEL=auto` probes NVENC → VA-API → QSV → CPU at worker start-up, so it is
the safest choice if you are unsure.

---

## 10. Updates

```bash
cd /srv/matchcast
git pull --ff-only
docker build -t matchcast/base:latest -f docker/Dockerfile.base .
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
# the backend entrypoint applies new migrations on boot
docker compose logs -f backend | grep -i migrate
```

Roll back by `git checkout <previous-tag>` and repeating the same two commands —
schema migrations are forward-only, so keep database backups before upgrading.

**If you deploy from the published images** (§2.1), updating is just:

```bash
cd /opt/matchcast
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.deploy.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.deploy.yml up -d
```

No git checkout, no build, no npm — the new image is already on ghcr.io.

---

## 11. Running without Docker (systemd)

If you would rather run the services directly, install Node 20, ffmpeg,
PostgreSQL and Redis on the host, then:

```bash
cd /srv/matchcast
npm ci
npm run build:shared
npm run prisma:generate
npm run db:deploy -w @matchcast/backend
npm run db:seed   -w @matchcast/backend
npm run build                    # backend, workers, frontend bundle
```

Create `/etc/systemd/system/matchcast-backend.service` (and equivalents for
`stream-worker`, `graphics-worker` with `npm run dev:stream` / `dev:graphics` or
`node stream-worker/dist/index.js`):

```ini
[Unit]
Description=MatchCast backend
After=network.target postgresql.service redis.service

[Service]
Type=simple
WorkingDirectory=/srv/matchcast/backend
EnvironmentFile=/srv/matchcast/backend/.env
ExecStart=/usr/bin/node /srv/matchcast/backend/dist/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/srv/matchcast/.runtime

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now matchcast-backend matchcast-stream-worker matchcast-graphics-worker
```

Serve `frontend/dist` with nginx (see §4) — the SPA needs `/api`, `/socket.io`
and `/media` proxied to the backend, plus a `try_files $uri /index.html` fallback.

---

## 12. Production checklist

- [ ] `.env` is `chmod 600`, outside git, and contains generated (not default) secrets
- [ ] `JWT_SECRET` ≥ 32 chars, `WORKER_TOKEN` ≥ 32 chars, `PREVIEW_TOKEN` randomised
- [ ] Default admin password changed on first login
- [ ] `ALLOW_ANY_ORIGIN=false`, `CORS_ORIGINS=https://<your-domain>`
- [ ] Postgres/Redis not reachable from the public interface
- [ ] TLS via Caddy/certbot; HTTP redirects to HTTPS
- [ ] `YOUTUBE_STREAM_KEY` only in `.env`; verify it never appears in logs (`grep -r "$KEY" logs`)
- [ ] Rights attestation recorded for the input feed (**Streaming → Input**)
- [ ] Automated DB backups + a tested restore
- [ ] `docker compose ps` all healthy; `/api/system/health` returns `db: "up"`
- [ ] One full rehearsal against `RTMP_TEST_URL` before match day

---

## 13. Quick troubleshooting

| Symptom | Where to look |
| --- | --- |
| Backend unhealthy / `db: "down"` | `docker compose logs backend`, `docker compose ps postgres` |
| “Input source is not rights-attested” | Streaming → Input → tick the rights confirmation (demo: `scripts/demo.sh` does it for you) |
| Stream stuck in `CONNECTING` | YouTube key invalid/not yet active, or the RTMP URL is wrong; test with `RTMP_TEST_URL` |
| Connected but 0 fps | input URL unreachable from the container (`docker compose exec stream-worker ffprobe …`) |
| No commentary | AI key missing → the offline rule-based engine is used; check Commentary settings and cooldown |
| No audio voiceover | TTS provider key missing → offline tone; check mixer volumes and ducking in Streaming → Audio |
| Dashboard frozen | WebSocket blocked by the proxy — re-read §4 (`Upgrade`/`Connection` headers) |
| Disk filling up | log rotation (`docker-compose.prod.yml`), replay buffer size, old HLS segments in `.runtime/preview` |

More detail in [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
