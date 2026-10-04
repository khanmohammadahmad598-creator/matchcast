# MatchCast architecture

```
                         ┌──────────────────────── control plane ───────────────────────┐
                         │                                                              │
  authorised feed        │   ┌────────────┐   REST + Socket.IO    ┌──────────────────┐  │
  (RTMP/SRT/HLS/file/ ───┼──▶│ stream-    │◀──────────────────────│  backend (API,   │  │
   device/demo clip)     │   │ worker     │   commands + status   │  Socket.IO hub,  │  │
                         │   │            │──────────────────────▶│  PostgreSQL,     │  │
                         │   │  ffmpeg    │   logs, commentary    │  Redis)          │  │
                         │   └─────┬──────┘                       └────────┬─────────┘  │
                         │         │ raw RGBA FIFO                         │            │
                         │         ▼                                       │            │
                         │   ┌────────────────┐   score snapshots          │            │
                         │   │ graphics-      │◀───────────────────────────┘            │
                         │   │ worker (Skia)  │                                         │
                         │   └─────┬──────────┘                                         │
                         │         │ scoreboard frames                                   │
                         └─────────┼─────────────────────────────────────────────────────┘
                                   ▼
                         ffmpeg filter_complex
                   ┌──────────────────────────────┐
                   │ [0] feed  → scale/fps → base │
                   │ [1] RGBA overlay → overlay   │
                   │ [0:a] feed audio (ducked)    │
                   │ [2] commentary PCM (TTS)     │
                   │ amix → limiter → [aout]      │
                   └───────────┬──────────────────┘
                               ├──▶ RTMP (YouTube Live / your own endpoint)
                               ├──▶ HLS preview (dashboard, low latency)
                               └──▶ replay segmenter (rolling buffer)
```

## Services

| Package | Responsibility | Key files |
| --- | --- | --- |
| `shared/` | Zod schemas, TS types, socket event names, constants. Imported by every service so contracts cannot drift. | `src/types.ts`, `src/schemas.ts`, `src/events.ts` |
| `backend/` | Control plane: REST API, Socket.IO hub, PostgreSQL persistence, settings, log store, worker registry. | `src/api/*`, `src/services/*`, `src/realtime/io.ts`, `prisma/schema.prisma` |
| `stream-worker/` | The broadcast engine: input manager, ffmpeg pipeline supervision, audio mixer, AI commentary, TTS, replay buffer, YouTube/RTMP output. | `src/pipeline/*`, `src/input/InputManager.ts`, `src/ai/*`, `src/tts/*`, `src/audio/AudioMixer.ts`, `src/replay/ReplayBuffer.ts` |
| `graphics-worker/` | Renders the scoreboard/overlay frames with Skia (node-canvas) into a raw RGBA named pipe that ffmpeg reads. | `src/renderers/canvas.ts`, `src/templates/*` |
| `frontend/` | React + Tailwind operator dashboard (Dashboard, Match Control, Commentary, Graphics, Streaming, Logs). | `src/pages/*`, `src/state/store.ts` |
| `docker/`, `scripts/`, `docs/` | Deployment, developer tooling, documentation. | – |

## Data flow for one delivery

1. **Scoring input.** An operator clicks a button in *Match Control*, or an
   authorised scorer pushes `POST /api/match/update`.
2. **`matchService.applyBall()`** (backend) writes the `Ball` row, updates the
   `Innings` aggregate, rotates the strike, changes the bowler at the end of an
   over, and derives **events** (`FOUR`, `SIX`, `WICKET`, `MILESTONE`, …).
3. **Broadcast.** The new `ScoreSnapshot` is emitted over Socket.IO
   (`score:update`) and persisted, so a restart can rebuild state.
4. **Graphics.** `graphics-worker` receives the snapshot and renders the next
   overlay frame into `/…/.runtime/frames/graphics.rgba`.
5. **Commentary.** `stream-worker` sees the events, `CommentaryEngine` decides
   whether to speak (speak-list, cooldown, priority, anti-repetition) and asks
   the AI provider (or the offline rule-based bank) for a line.
6. **TTS.** The line is queued in `TtsService`, synthesised by the configured
   provider, decoded to PCM, and played **sequentially** into the mixer (never
   overlapping), with the original feed audio ducked while it plays.
7. **Encoding.** ffmpeg composites feed + overlay, mixes audio, and pushes RTMP
   to YouTube (plus the HLS preview and the replay segmenter).
8. **Telemetry.** FPS, bitrate, dropped frames, reconnects and errors flow back
   to the backend and are streamed to the dashboard and the log store.

## Failure behaviour

| Failure | Behaviour |
| --- | --- |
| ffmpeg crashes / RTMP drops | `Pipeline` restarts with exponential backoff (max `MAX_RESTART_BACKOFF_SECONDS`), backoff resets after 30 s of healthy running |
| ffmpeg hangs (no progress) | Watchdog kills and restarts the generation |
| Input source lost | `InputManager` reconnects; the pipeline is rebuilt when the URL changes |
| graphics-worker down | `OverlayInput.hasWriter()` is false → the pipeline degrades to a text score bug, stream continues |
| AI provider errors | The event is dropped, logged, and the stream continues |
| TTS provider errors | The line is marked `FAILED` and skipped; the queue keeps draining |
| Backend unreachable | Workers keep broadcasting with the last known settings and buffer logs locally |
| Worker process dies | Restart (Docker/systemd) → it re-reads config via `/api/internal/bootstrap` and auto-resumes an open session |

## State & recovery

* **PostgreSQL** is the source of truth (matches, innings, balls, events,
  commentary, TTS clips, stream sessions, graphics templates, system logs).
* **Redis** is optional: it fans Socket.IO across backend replicas and caches
  transient state. If it is unavailable the backend falls back to single-node
  mode with a warning.
* **Settings** live in the `app_settings` table, validated on read by the shared
  zod schemas — a half-written row can never crash a worker.
* **Stream sessions** record start/stop, resolution, bitrate, bytes sent,
  reconnect count and end reason. An open session newer than 6 h makes a
  restarted `stream-worker` resume the broadcast automatically.
