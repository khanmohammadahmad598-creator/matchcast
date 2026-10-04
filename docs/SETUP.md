# Setup & installation

Two paths: **Docker Compose** (recommended for a VPS) and **local development**
(what you want while building).

> ⚠️ Compliance: only stream video you own or are licensed to broadcast.
> Read [`COMPLIANCE.md`](./COMPLIANCE.md) first.

---

## 1. Requirements

| | Local dev | Docker |
| --- | --- | --- |
| Node.js | ≥ 20.11 | in image |
| PostgreSQL | 15+ (17 used here) | in image |
| Redis | 7 (optional but recommended) | in image |
| FFmpeg | 6+ with libx264 + aac | in image |
| Docker | – | 24+ with Compose v2 |

Optional: an OpenAI / Anthropic / Gemini key (AI commentary) and an OpenAI /
ElevenLabs / Google key (TTS). **Without any key the system still works**: the
rule-based commentary bank and the offline tone-based TTS mock are used.

---

## 2. Local development (no Docker)

```bash
git clone <your-repo> matchcast && cd matchcast

# 1. Install every workspace
npm install

# 2. Build the shared package (types/schemas consumed by all services)
npm run build:shared

# 3. Create the environment files
cp .env.example backend/.env
cp .env.example stream-worker/.env      # same file also works for the other services
cp .env.example graphics-worker/.env
cp .env.example frontend/.env
# then edit each file (see "Environment" below)

# 4. Database
sudo -n pg_ctlcluster 17 main start          # Debian/Ubuntu, if not already running
cd backend
npx prisma migrate deploy                    # or: npx prisma migrate dev
npm run db:seed                              # demo teams, players, match, templates
cd ..

# 5. Generate the synthetic demo asset used by DEMO mode
bash scripts/make-demo-asset.sh 60           # -> demo-assets/demo-match.mp4

# 6. Run everything
npm run dev
```

`npm run dev` starts (with `concurrently`):

| Service | URL |
| --- | --- |
| backend (API + Socket.IO) | http://localhost:4000 |
| stream-worker | – (connects to the backend) |
| graphics-worker | – (connects to the backend) |
| frontend (Vite) | http://localhost:5173 |

Default admin: `admin@matchcast.local` / `ChangeMeNow123!` — **change it on
first login** (`Auth → users`, or `DEFAULT_ADMIN_PASSWORD` before first boot).

### Start a local test broadcast without YouTube

```bash
# Terminal A - a tiny RTMP sink (any RTMP server works: nginx-rtmp, SRS, this)
while true; do
  ffmpeg -hide_banner -loglevel error -y -listen 1 -f flv \
    -i rtmp://0.0.0.0:1935/live/test -c copy -f mpegts /tmp/received.ts
  sleep 1
done

# Terminal B
curl -X POST http://localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@matchcast.local","password":"ChangeMeNow123!"}'   # -> token

curl -X POST http://localhost:4000/api/stream/start -H "authorization: Bearer $TOKEN"
curl     http://localhost:4000/api/stream/status   -H "authorization: Bearer $TOKEN"
```

Set `RTMP_TEST_URL=rtmp://127.0.0.1:1935/live/test` in `stream-worker/.env` and
leave `YOUTUBE_STREAM_KEY` empty: the worker warns and uses the test endpoint.

### Going live on YouTube

1. YouTube Studio → **Go live** → copy the *Stream URL* and *Stream key*.
2. `YOUTUBE_RTMP_URL=rtmps://a.rtmps.youtube.com/live2`
3. `YOUTUBE_STREAM_KEY=<your key>` (server-side only — never in the frontend).
4. Restart `stream-worker`, then press **Start** in the dashboard.

---

## 3. Docker Compose

```bash
cp .env.example .env          # fill in JWT_SECRET, WORKER_TOKEN, POSTGRES_PASSWORD
docker build -t matchcast/base:latest -f docker/Dockerfile.base .
docker compose up -d --build
docker compose logs -f stream-worker
```

| Service | Port |
| --- | --- |
| frontend (nginx) | 8080 |
| backend | 4000 |
| postgres | 5432 |
| redis | 6379 (internal) |

Migrations and seeding run automatically on backend start (see
`docker/entrypoint-backend.sh`).

---

## 4. Environment variables

Full annotated template: [`.env.example`](../.env.example).

### backend/.env

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | development | |
| `PORT` / `HOST` | 4000 / 0.0.0.0 | |
| `DATABASE_URL` | – | PostgreSQL connection string |
| `REDIS_URL` | – | Optional; enables multi-replica Socket.IO |
| `JWT_SECRET` | – | **Required**, ≥ 16 chars |
| `JWT_EXPIRES_IN` | 12h | |
| `WORKER_TOKEN` | – | Shared secret for worker → backend calls |
| `SCORING_API_KEY` | – | Enables `POST /api/match/update` |
| `CORS_ORIGINS` | http://localhost:5173 | Comma separated |
| `ALLOW_ANY_ORIGIN` | false | Dev convenience only |
| `PREVIEW_TOKEN` | preview | Random path segment for the HLS preview |
| `YOUTUBE_RTMP_URL` | rtmps://a.rtmps.youtube.com/live2 | |
| `YOUTUBE_STREAM_KEY` | – | Never returned by any API |
| `MEDIA_DIR`, `PREVIEW_DIR`, `TTS_DIR`, `FRAMES_DIR`, `LOG_DIR` | `.runtime/*` | Must match the workers |
| `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` | admin@matchcast.local | First boot only |

### stream-worker/.env

| Variable | Default | Notes |
| --- | --- | --- |
| `BACKEND_URL` | http://127.0.0.1:4000 | |
| `WORKER_TOKEN` | – | Must match the backend |
| `YOUTUBE_RTMP_URL` / `YOUTUBE_STREAM_KEY` | – | Output target |
| `RTMP_TEST_URL` | – | Used when no key is set (local loopback testing) |
| `DEMO_VIDEO` | ../demo-assets/demo-match.mp4 | DEMO input |
| `FFMPEG_PATH` | ffmpeg | Absolute path if ffmpeg is not on `PATH` |
| `HW_ACCEL` | auto | `auto` \| `off` \| `nvidia` \| `vaapi` \| `qsv` |
| `PIPELINE_WATCHDOG_SECONDS` | 20 | Restart when ffmpeg stops reporting |
| `MAX_RESTART_BACKOFF_SECONDS` | 30 | Cap for the restart backoff |
| `PREVIEW_ENABLED` / `PREVIEW_BITRATE_KBPS` | true / 900 | Operator preview |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | – | AI commentary |
| `ELEVENLABS_API_KEY`, `GOOGLE_TTS_API_KEY` | – | TTS |
| `FRAMES_DIR`, `TTS_DIR`, `PREVIEW_DIR`, `REPLAY_DIR` | `.runtime/*` | Must match the backend |

### graphics-worker/.env

`BACKEND_URL`, `WORKER_TOKEN`, `FRAMES_DIR`, `GRAPHICS_FIFO_NAME`, `GRAPHICS_FPS`.

### frontend/.env

`VITE_API_BASE` (`/api` in Docker), `VITE_SOCKET_URL` (blank = same origin),
`VITE_PREVIEW_TOKEN` (must equal the backend `PREVIEW_TOKEN`).

---

## 5. Testing

```bash
npm run typecheck     # tsc --noEmit for every package
npm test              # vitest: backend + stream-worker + graphics-worker (108 tests)
npm run test -w @matchcast/backend         # single package
npx vitest run src/__tests__/realtime.test.ts -w @matchcast/backend
```

The backend suite talks to a real PostgreSQL database (it creates and deletes its
own fixtures), so run `npx prisma migrate deploy` first. The stream-worker
supervision specs additionally need `ffmpeg` on `PATH`.

End-to-end smoke test against a running stack:

```bash
npx tsx scripts/demo-scoring.ts --balls 24        # drives deliveries via the API
npx tsx scripts/demo-scoring.ts --provider --balls 12   # via /api/match/update
```

---

## 6. Production checklist

- [ ] `JWT_SECRET`, `WORKER_TOKEN`, `POSTGRES_PASSWORD` set to long random values
- [ ] Default admin password changed
- [ ] `NODE_ENV=production`, `ALLOW_ANY_ORIGIN=false`, `CORS_ORIGINS` set to your domain
- [ ] HTTPS in front of the dashboard (nginx/Caddy) — cookies are `Secure` in production
- [ ] `YOUTUBE_STREAM_KEY` only in the worker environment (never committed)
- [ ] Logs rotated (`LOG_DIR`) and database backed up
- [ ] Firewall: 1935/10000 only from your contribution encoders; 4000/8080 behind the proxy
