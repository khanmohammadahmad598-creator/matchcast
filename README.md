# MatchCast — AI Live Match Streaming & Commentary Platform

[![CI](https://github.com/khanmohammadahmad598-creator/matchcast/actions/workflows/ci.yml/badge.svg)](https://github.com/khanmohammadahmad598-creator/matchcast/actions/workflows/ci.yml)
[![Publish images](https://github.com/khanmohammadahmad598-creator/matchcast/actions/workflows/publish.yml/badge.svg)](https://github.com/khanmohammadahmad598-creator/matchcast/actions/workflows/publish.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-107%20passing-brightgreen.svg)](#testing)
[![Images](https://img.shields.io/badge/ghcr.io-5%20images-blue.svg)](https://github.com/khanmohammadahmad598-creator?tab=packages)

Broadcast **your own** sports production to YouTube Live with an automatic
scoreboard, AI commentary in Hindi/Hinglish/English, text-to-speech voiceover
and audio ducking — running 24/7 with auto-reconnect and graceful degradation.

```
authorised feed ─▶ ffmpeg processing ─▶ live scoreboard graphics ─┐
   (RTMP/SRT/HLS/file/device/demo)                                ├─▶ YouTube RTMP
score events ──▶ AI commentary ─▶ Hindi/Hinglish TTS ─▶ audio mix ─┘     (+ HLS preview, replay buffer)
```

> **Compliance first.** MatchCast only streams feeds you own or are licensed to
> broadcast. It contains — and must never contain — any capability for ripping,
> DRM bypass, watermark removal or circumventing platform protections. See
> [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md).

---

## Features

| # | Area | What you get |
| --- | --- | --- |
| 1 | **Input manager** | RTMP / SRT / HLS / local file / capture device / demo clip. Connection state, bitrate, FPS, reconnect with backoff, source preview, rights attestation |
| 2 | **Processing** | 720p/1080p @ 30/50/60 fps, automatic hardware-encoder detection (NVENC/VA-API/QSV/CPU), auto bitrate, A/V sync, low-latency flags, auto-restart on any component failure |
| 3 | **Scoreboard** | Teams, runs, wickets, overs, striker, non-striker, bowler, current over, RRR, target, partnership, recent balls. Manual dashboard control **and** `POST /api/match/update` for scoring providers — all live, no restart |
| 4 | **AI commentary** | Hindi / Hinglish / English; professional, excited, calm, fast, expert styles. Never invents events: every line is generated from real scoring facts. Anti-repetition window + cooldown + priority gating |
| 5 | **TTS layer** | Provider abstraction (OpenAI, ElevenLabs, Google, offline mock), male/female voices, Hindi/English/Hinglish, speed/volume/pitch, sequential queue so lines never overlap |
| 6 | **Audio mixer** | Original feed + commentary + optional background bed, per-bus volume, mute, sidechain ducking of the feed while commentary speaks, limiter. No bundled music |
| 7 | **Replay buffer** | Rolling segments for sixes/fours/wickets/milestones with pre/post roll, slow-mo playback rate and archive-only mode (zero added latency)  See [`docs/REPLAYS.md`](docs/REPLAYS.md) |
| 8 | **Graphics engine** | Template system (Modern / Classic / Minimal), team logos, player names, match title, tournament, sponsor banner, lower thirds, flash graphics, intro/outro, LIVE badge — hot-swappable live |
| 9 | **YouTube output** | RTMP(S) ingest, stream key read from env only, masked in logs, never returned by any API. Start / stop / restart / reconnect with status, bitrate, FPS and error reporting |
| 10 | **Dashboard** | React + Tailwind: Dashboard, Match Control, Commentary, Graphics, Streaming, System Logs — responsive and realtime |
| 11 | **Persistence** | PostgreSQL + Prisma: users, matches, teams, players, innings, balls, score events, commentary, TTS audio, stream sessions, graphics templates, system logs |
| 12 | **Realtime** | Socket.IO: score → dashboard + graphics + commentary instantly, no refresh |
| 13 | **Failover** | Input / YouTube / TTS / AI / scoring API / graphics / ffmpeg failures all degrade gracefully — the stream keeps running |
| 14 | **Security** | bcrypt hashes, JWT auth, role-based admin APIs (ADMIN/OPERATOR/VIEWER), self-service password rotation, rate limiting, zod validation everywhere, secret management |
| 15 | **Stack** | React + TS + Tailwind · Node + TS + Express · Socket.IO · PostgreSQL + Prisma · FFmpeg · provider abstractions · Docker Compose |
| 16 | **Docker** | 6 services: frontend, backend, postgres, redis, stream-worker, graphics-worker |
| 17 | **Repo layout** | `/frontend /backend /stream-worker /graphics-worker /shared /docker /scripts /docs` + `.env.example`, Dockerfiles, compose file, migrations, API docs |
| 18 | **Tests** | 107 vitest specs: scoring, commentary, TTS queue, ffmpeg args + restart/backoff, YouTube target masking, auth/RBAC, API validation, graphics templates, **realtime Socket.IO delivery, worker command routing, replay buffer, encoder detection** |
| 19 | **Demo mode** | Synthetic locally generated match clip + scripted deliveries → commentary + TTS + scoreboard + RTMP output, no third-party content |

---

## Quick start (local, no Docker)

```bash
npm install
npm run build:shared
cp .env.example backend/.env && cp .env.example stream-worker/.env \
  && cp .env.example graphics-worker/.env && cp .env.example frontend/.env
cd backend && npx prisma migrate deploy && npm run db:seed && cd ..
bash scripts/make-demo-asset.sh 60          # synthetic demo clip (safe to stream)
npm run dev                                  # backend :4000 + frontend :5173 + both workers
```

Open http://localhost:5173 → login `admin@matchcast.local` / `ChangeMeNow123!`
→ **Streaming** → tick the rights checkbox → **Start**.

Detailed instructions: [`docs/SETUP.md`](docs/SETUP.md) · [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Docker (local build):

```bash
cp .env.example .env
docker build -t matchcast/base:latest -f docker/Dockerfile.base .
docker compose up -d --build
```

Docker on a VPS (prebuilt images published by GitHub Actions, no build on the
server — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §2.1):

```bash
curl -fsSL https://raw.githubusercontent.com/khanmohammadahmad598-creator/matchcast/main/scripts/deploy-vps.sh | bash
```

Every push to `main` publishes five images to GitHub Container Registry
(`main`, `sha-<short>`, `latest`; pullable anonymously), verified by the
**Publish images** workflow:

| Image | Runs |
|---|---|
| `ghcr.io/khanmohammadahmad598-creator/matchcast-frontend` | nginx + dashboard bundle |
| `ghcr.io/khanmohammadahmad598-creator/matchcast-backend` | API, Socket.IO, audio mixer |
| `ghcr.io/khanmohammadahmad598-creator/matchcast-stream-worker` | ffmpeg pipeline, replay buffer |
| `ghcr.io/khanmohammadahmad598-creator/matchcast-graphics-worker` | scoreboard renderer |
| `ghcr.io/khanmohammadahmad598-creator/matchcast-base` | shared Node + ffmpeg base |

---

## Where each file belongs

```
matchcast/
├── shared/                     # contracts shared by every service
│   ├── src/types.ts            #   ScoreSnapshot, MatchEvent, settings types
│   ├── src/schemas.ts          #   zod schemas (single source of validation)
│   └── src/events.ts           #   Socket.IO event names + rooms
│
├── backend/                    # control plane (Express + Socket.IO + Prisma)
│   ├── prisma/schema.prisma    #   database schema (11 tables)
│   ├── prisma/seed.ts          #   demo teams, players, match, templates
│   └── src/
│       ├── index.ts            #   app factory + bootstrap
│       ├── api/                #   auth, matches, scoring, commentary, tts,
│       │                       #   graphics, streaming, system, internal
│       ├── services/           #   matchService (cricket engine), streamService,
│       │                       #   commentaryService, graphicsService, settings,
│       │                       #   logService, systemStats
│       ├── realtime/io.ts      #   Socket.IO hub + worker command channel
│       └── middleware/         #   auth (JWT/RBAC), validate (zod), errors
│
├── stream-worker/              # the broadcast engine
│   └── src/
│       ├── index.ts            #   orchestration: commands → pipeline
│       ├── input/InputManager.ts     # RTMP/SRT/HLS/file/device/demo + reconnect
│       ├── pipeline/Pipeline.ts      # ffmpeg supervision, backoff, watchdog
│       ├── pipeline/ffmpegArgs.ts    # the complete ffmpeg graph
│       ├── pipeline/encoder.ts       # hardware-encoder detection
│       ├── ai/CommentaryEngine.ts    # when to speak / what to say
│       ├── ai/{providers,prompts,antiRepetition}.ts
│       ├── tts/TtsService.ts         # sequential, non-overlapping queue
│       ├── tts/providers/index.ts    # OpenAI / ElevenLabs / Google / offline
│       ├── audio/AudioMixer.ts       # feed + commentary + bed, ducking, limiter
│       ├── graphics/overlay.ts       # FIFO bridge + degraded text bug
│       └── replay/ReplayBuffer.ts    # rolling segments + clip extraction
│
├── graphics-worker/            # overlay renderer (Skia via node-canvas)
│   └── src/
│       ├── index.ts            #   render loop, FIFO writer, control socket
│       ├── renderers/canvas.ts #   RGBA frames for the FIFO
│       └── templates/          #   cricketModern / cricketClassic / cricketMinimal
│
├── frontend/                   # operator dashboard (React + Vite + Tailwind)
│   └── src/
│       ├── pages/              #   Dashboard, MatchControl, Commentary,
│       │                       #   Graphics, Streaming, Logs, Login
│       ├── components/         #   Layout, VideoPreview (HLS), UI kit
│       ├── state/store.ts      #   zustand store wired to Socket.IO
│       └── lib/{api,socket}.ts
│
├── docker/                     # Dockerfile.base|.backend|.stream-worker|
│                               # .graphics-worker|.frontend, nginx.conf
├── docker-compose.yml          # 6 services
├── scripts/                    # setup.sh, make-demo-asset.sh, demo-scoring.ts, demo.sh
├── docs/                       # ARCHITECTURE, API, SETUP, COMPLIANCE, TROUBLESHOOTING
└── .env.example                # fully annotated environment template
```

---

## How a delivery travels through the system

1. **Scoring** — operator clicks (Match Control) or a provider posts
   `POST /api/match/update`.
2. **`backend/src/services/matchService.ts`** writes the ball, updates the
   innings, rotates strike, changes the bowler at the end of an over,
   credits maidens, and derives events (`FOUR`, `SIX`, `WICKET`, `MILESTONE`).
3. **Socket.IO** broadcasts the new `ScoreSnapshot` (`score:update`).
4. **`graphics-worker`** renders the next overlay frame into the RGBA FIFO.
5. **`CommentaryEngine`** decides whether to speak (speak-list, cooldown,
   priority, anti-repetition) and generates a grounded line.
6. **`TtsService`** synthesises it and plays it **sequentially** into the mixer,
   ducking the feed audio while it speaks.
7. **ffmpeg** composites feed + overlay, mixes audio, pushes **RTMP to
   YouTube** plus the operator HLS preview and the replay segmenter.
8. **Telemetry** (fps, bitrate, reconnects, errors) flows back to the dashboard.

Full diagram and failure matrix: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## API surface

| Group | Examples |
| --- | --- |
| Auth | `POST /api/auth/login`, `/me`, `/register`, `/logout` |
| Matches | `GET/POST /api/matches`, `GET /api/matches/:id`, `/players`, `/balls` |
| Scoring | `POST /api/match/:id/{start,innings,ball,wicket,boundary,undo,batters,target,event}` |
| Provider | `POST /api/match/update` (`X-Scoring-Api-Key`) |
| State | `GET /api/match/:id/state`, `GET /api/match/state` |
| Streaming | `GET /api/stream/status`, `POST /api/stream/{start,stop,restart,reconnect}`, `GET/PUT /api/stream/{input,output,audio,replay}` |
| Commentary / TTS | `GET/PUT settings`, `POST speak`, `POST trigger`, `GET history`, `GET /api/tts/voices` |
| Graphics | `GET/PUT /api/graphics/settings`, `GET /api/graphics/templates`, `POST /upload`, `POST /flash` |
| System | `GET /api/system/{health,stats,logs,logs/db,authorized-sources}` |

Complete reference: [`docs/API.md`](docs/API.md).

---

## Configuration highlights

| Variable | Where | Purpose |
| --- | --- | --- |
| `YOUTUBE_RTMP_URL` / `YOUTUBE_STREAM_KEY` | stream-worker | Output target. The key is read from env only, masked in logs, never returned by the API |
| `RTMP_TEST_URL` | stream-worker | Local loopback target for testing without YouTube |
| `DATABASE_URL`, `REDIS_URL` | backend | PostgreSQL (required) and Redis (optional, multi-replica realtime) |
| `JWT_SECRET`, `WORKER_TOKEN`, `SCORING_API_KEY` | backend + workers | Security |
| `HW_ACCEL` | stream-worker | `auto` \| `off` \| `nvidia` \| `vaapi` \| `qsv` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | stream-worker | AI commentary (rule-based offline bank is used when unset) |
| `ELEVENLABS_API_KEY` / `GOOGLE_TTS_API_KEY` | stream-worker | Real voices (offline mock otherwise) |

Everything is documented in [`.env.example`](.env.example) and
[`docs/SETUP.md`](docs/SETUP.md#4-environment-variables).

---

## Testing

```bash
npm run typecheck           # tsc --noEmit, all 5 packages
npm test                    # 107 vitest specs (backend 43, stream-worker 58, graphics 6)
bash scripts/demo.sh        # full end-to-end demo against a running stack
```

CI runs the same three commands on every push/PR (`.github/workflows/ci.yml`)
against a real PostgreSQL 16 service container.

Coverage map:

| Area | Spec |
| --- | --- |
| Score updates | `backend/src/__tests__/scoring.test.ts` (runs, overs, wides, strike rotation, bowler change, wicket, provider API, validation) |
| Auth / RBAC / rate limiting | `backend/src/__tests__/auth.test.ts` |
| Stream API + secret hygiene | `backend/src/__tests__/streaming.test.ts` |
| Realtime (Socket.IO) | `backend/src/__tests__/realtime.test.ts` (score/graphics push with no refresh, anonymous read-only viewers, worker auth, command routing, forged-JWT rejection, worker-room isolation) |
| Commentary generation | `stream-worker/src/ai/__tests__/commentary.test.ts` (speak list, cooldown, anti-repetition, grounding, failure isolation) |
| TTS queue | `stream-worker/src/tts/__tests__/ttsQueue.test.ts` (no overlap, priority, overflow, READY→PLAYED, failures) |
| FFmpeg graph | `stream-worker/src/pipeline/__tests__/ffmpegArgs.test.ts` (chain separators, split for preview, ducking, HW encoder, key redaction) |
| FFmpeg restart / YouTube reconnect | `stream-worker/src/pipeline/__tests__/restart.test.ts`, `src/core/__tests__/rtmpTarget.test.ts` |
| Graphics templates | `graphics-worker/src/__tests__/templates.test.ts` |

End-to-end (Socket.IO, pipeline, TTS): `bash scripts/demo.sh` — it starts a
local RTMP sink, goes live and drives deliveries while you watch the dashboard.

---

## Operations notes

* **Latency.** `tune=zerolatency`, 2 s GOP and `flvflags no_duration_filesize`
  keep the RTMP output in the normal YouTube latency range. Replay insertion
  (`mode: cut`) adds a few seconds — keep it `off` (archive only) if you need the
  lowest possible latency.
* **Bitrate.** 720p30 ≈ 2500–4500 kbps, 1080p30 ≈ 4500–9000 kbps. Watch
  `speed` in `/api/stream/status`: below `1.0` the CPU cannot keep up.
* **Restarts.** A worker that dies comes back, reads its config from
  `/api/internal/bootstrap`, and resumes an open stream session (younger than
  6 h) automatically.
* **Logs.** Dashboard → Logs page (live Socket.IO tail) and
  `GET /api/system/logs/db` for history.

---

## License & responsibility

You are responsible for the content you broadcast. Use only footage, music,
logos and data you own or are licensed to use, and follow the platform's terms.
This project ships no media assets of its own beyond the synthetic clip you
generate locally with `scripts/make-demo-asset.sh`.
