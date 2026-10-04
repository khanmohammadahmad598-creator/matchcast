# MatchCast REST API

Base URL: `http://<host>:4000/api`

All endpoints accept/return JSON. Authentication is a JWT bearer token obtained
from `POST /api/auth/login` (an `HttpOnly` cookie is set as well). Worker-only
endpoints use the shared `x-worker-token` header instead.

Roles: `ADMIN` (everything), `OPERATOR` (run the show: scoring, stream control,
graphics), `VIEWER` (read-only).

---

## Health & system

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/system/health` | – | Liveness probe (used by Docker healthchecks) |
| GET | `/api/system/stats` | viewer | CPU/memory/disk + worker heartbeats |
| GET | `/api/system/logs` | viewer | In-memory log tail (`?level=&source=&search=`) |
| GET | `/api/system/logs/db` | viewer | Persisted logs (`?limit=&level=&source=`) |
| GET | `/api/system/authorized-sources` | operator | Rights register: every source you declared |

`GET /api/stream/status` is the single most useful endpoint for an operator — it
returns the pipeline state, FPS, bitrate, uptime, reconnect counts, last error and
the online/offline state of both workers.

---

## Authentication

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | – | Rate limited; returns `{ token, user }` |
| POST | `/api/auth/logout` | – | Clears the session cookie |
| GET | `/api/auth/me` | viewer | Current user from token |
| POST | `/api/auth/register` | admin | Creates `ADMIN`/`OPERATOR`/`VIEWER` users |

Passwords are hashed with bcrypt (cost 12). Tokens are signed with `JWT_SECRET`
and expire after `JWT_EXPIRES_IN` (default 12h).

---

## Matches

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/matches` | viewer | All matches with teams + current innings |
| POST | `/api/matches` | operator | Creates a match with both squads |
| GET | `/api/matches/:id` | viewer | Full detail incl. innings, balls, events |
| PATCH | `/api/matches/:id` | operator | Title/status/teams |
| GET | `/api/matches/:id/players` | viewer | Squads for the match-control UI |
| GET | `/api/matches/:id/balls` | viewer | Last 200 deliveries |

---

## Scoring (dashboard + provider)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/api/match/:id/start` | operator | Creates innings 1, auto-selects openers + opening bowler |
| POST | `/api/match/:id/innings` | operator | Starts the next innings (target = prev + 1) |
| POST | `/api/match/:id/ball` | operator | Record a delivery: `{ runs, extraType, isWicket, wicketKind, batterRuns, newBatterId }` |
| POST | `/api/match/:id/boundary` | operator | Shorthand for a four or six: `{ runs: 4 \| 6 }` |
| POST | `/api/match/:id/wicket` | operator | `{ wicketKind, batterOutId, newBatterId }` |
| POST | `/api/match/:id/undo` | operator | Rolls back the last delivery |
| POST | `/api/match/:id/batters` | operator | Manually set striker/non-striker |
| POST | `/api/match/:id/target` | operator | Set/clear the chase target |
| POST | `/api/match/:id/event` | operator | Manual commentary event (non-scoring) |
| GET | `/api/match/:id/state` | viewer | `{ snapshot }` – the exact object the graphics + commentary consume |
| GET | `/api/match/state` | viewer | State of the currently live match |
| POST | `/api/match/update` | **provider** | Push a whole score line (see below) |

### Provider push (`POST /api/match/update`)

Authenticate with `X-Scoring-Api-Key: <SCORING_API_KEY>` (JWT also accepted).
Every field is optional; only what changed needs to be sent.

```jsonc
{
  "matchId": "uuid",            // omit to use the live match
  "batting_team": "India",      // or "team"
  "runs": 148, "wickets": 3,
  "overs": "16.2",              // decimal overs notation
  "striker": "V Kohli", "striker_runs": 62, "striker_balls": 38,
  "non_striker": "R Sharma",
  "bowler": "M Starc", "bowler_wickets": 1, "bowler_runs": 28,
  "target": 190,                // null to clear
  "innings": 2,
  "note": "end of over"
}
```

Unknown player names are auto-registered against the relevant team, and any
change raises the same real events (`FOUR`, `SIX`, `WICKET`, `MILESTONE` …) the
dashboard buttons produce — so commentary, graphics and TTS behave identically.

---

## Streaming

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/stream/status` | viewer | Pipeline + workers |
| POST | `/api/stream/start` | operator | **403 unless the input is rights-attested** |
| POST | `/api/stream/stop` | operator | Graceful stop, closes the session |
| POST | `/api/stream/restart` | operator | Rebuilds the ffmpeg graph |
| POST | `/api/stream/reconnect` | operator | Reconnects the RTMP output only |
| GET/PUT | `/api/stream/input` | viewer / operator | Source (`demo`, `file`, `rtmp`, `srt`, `hls`, `device`) |
| GET/PUT | `/api/stream/output` | viewer / operator | Resolution, fps, bitrate, preset. **Never returns the stream key** |
| GET/PUT | `/api/stream/audio` | viewer / operator | Mix volumes, ducking, background track |
| GET/PUT | `/api/stream/replay` | viewer / operator | Replay buffer settings |
| GET | `/api/stream/sessions` | viewer | Past broadcasts with end reason |

---

## Commentary, TTS, graphics

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET/PUT | `/api/commentary/settings` | viewer / operator | Language, style, verbosity, cooldown, speak-on events |
| POST | `/api/commentary/speak` | operator | Type a line and have it spoken immediately |
| POST | `/api/commentary/trigger` | operator | Force an event-type line |
| GET | `/api/commentary/history` | viewer | Generated lines with TTS status |
| GET/PUT | `/api/tts/settings` | viewer / operator | Provider, voice, speed, volume, pitch |
| GET | `/api/tts/voices` | viewer | Available voices per provider/language |
| POST | `/api/tts/speak` | operator | Speak arbitrary text |
| POST | `/api/tts/clear` | operator | Empty the queue |
| GET | `/api/tts/audio` | viewer | Synthesised clips |
| GET/PUT | `/api/graphics/settings` | viewer / operator | Template, colours, badges, position |
| GET | `/api/graphics/templates` | viewer | Registered templates |
| POST | `/api/graphics/templates` | operator | Create a custom template |
| POST | `/api/graphics/templates/:id/apply` | operator | Switch live template (no restart) |
| POST | `/api/graphics/upload` | operator | Logo/image upload (multipart `file`) |
| POST | `/api/graphics/flash` | operator | Show a lower-third/flash graphic |

---

## Internal (workers only, `x-worker-token`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/internal/bootstrap` | Settings + snapshot + `stream.shouldRun` (auto-resume) |
| POST | `/api/internal/stream/status` | Pipeline metrics |
| POST | `/api/internal/worker/status` | Worker heartbeat |
| POST | `/api/internal/logs` | Batched log shipping |
| POST/PATCH | `/api/internal/commentary` | Persist a line / update its TTS status |
| POST | `/api/internal/tts-audio` | Register a synthesised clip |
| POST | `/api/internal/replay-clip` | Register a saved replay |

---

## Socket.IO events

Namespace `/`, room `dashboard`. Workers join `worker:stream` / `worker:graphics`
and receive commands (`stream:start`, `input:set`, `audio:mix`, `tts:speak`,
`graphics:settings`, `commentary:trigger`, …).

| Event | Direction | Payload |
| --- | --- | --- |
| `score:update` | server → client | `ScoreSnapshot` |
| `match:update` | server → client | match row (status/teams changed) |
| `match:event` | server → client | `MatchEvent[]` raised by a delivery |
| `commentary:new` | server → client | commentary row (text + TTS status) |
| `graphics:update` | server → client | `GraphicsSettings` (live template swap) |
| `settings:update` | server → client | AI / TTS / audio / output settings |
| `stream:status` | server → client | pipeline status (fps, bitrate, errors) |
| `input:status` | server → client | input connection state |
| `system:stats` | server → client | host + worker metrics |
| `log:new` | server → client | log entry |
| `replay:clip` | server → client | replay saved |
| `worker:status` | worker → server | heartbeat (relayed to the dashboard) |
| `worker:command` | server → worker | `stream:start`/`stop`/`restart`, `input:set`, `audio:mix`, `tts:*`, `graphics:*`, `commentary:trigger`, `replay:settings` |
