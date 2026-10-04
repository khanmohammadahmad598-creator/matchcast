# Replays (optional rolling buffer)

MatchCast can capture the last few seconds of the live feed whenever a big
moment happens — a six, a four, a wicket or a milestone — and either archive it
or cut to it on air in slow motion.

> Replays are **off by default** because inserting one pauses the live feed for
> the length of the clip. Enable them only when you accept that trade-off.

## How it works

```
ffmpeg ─┬─▶ RTMP out (YouTube)          live, never interrupted in 'off'/'overlay' modes
        ├─▶ HLS preview                 dashboard monitor
        └─▶ segment ring (replay)       5-second MPEG-TS segments, 24-file wrap
                  │
        scoring event (SIX/WICKET/…) ─▶ backend ─▶ `replay:capture` ─▶ stream-worker
                                                          │
                                    wait post-roll ─▶ concat last N segments
                                                  ─▶ slow motion (`setpts` + `atempo`)
                                                  ─▶ replay-clip.mp4 ─▶ DB + dashboard
                                                  ─▶ mode 'cut': pipeline restarts with
                                                     the clip as input, then returns to live
```

| Stage | Where |
|---|---|
| Segment ring (ffmpeg `-f segment`) | `stream-worker/src/pipeline/ffmpegArgs.ts` (output 3) |
| Ring reader, concat, slow motion | `stream-worker/src/replay/ReplayBuffer.ts` |
| Trigger decision (event type, enabled) | `backend/src/services/streamService.ts` → `maybeCaptureReplay()` |
| Settings + API | `PUT /api/stream/replay`, `backend/src/api/streaming.ts` |
| Clip register | `replay_clips` table (`backend/prisma/schema.prisma`) |
| Dashboard | Streaming → **Replays** card |

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Writes the segment ring and captures clips |
| `preRollSeconds` | `8` | How much of the action *before* the event to keep |
| `postRollSeconds` | `4` | How long to wait *after* the event so the follow-through is included |
| `mode` | `off` | `off` = archive only · `cut` = switch the output to the clip, then back to live · `overlay` = reserved |
| `playbackRate` | `0.6` | 0.6 = 40 % slower. Slow motion stretches the clip, so a 9 s window becomes ≈ 15 s on air |
| `maxLatencySeconds` | `6` | Guard rail: the worker skips an insertion that would add more latency than this |
| `triggerEvents` | `SIX, WICKET, MILESTONE` | Which scoring events start a capture (`FOUR`, `OVER_END`, `INNINGS_END`, `CUSTOM` also available) |

Change them from the dashboard (Streaming → Replays) — the backend forwards them
to the stream-worker over Socket.IO. Turning the ring **on** restarts the
pipeline once, because ffmpeg needs a new output; every other change is applied
immediately without dropping the broadcast.

## Latency budget

| Mode | Added latency | What the viewer sees |
|---|---|---|
| `off` | ~0 s | Nothing — clips are only saved to disk and listed in the dashboard |
| `cut` | clip length (≈ `preRoll + postRoll`) ÷ 0.6 | Live feed pauses, the replay plays (with a REPLAY badge), then live resumes |
| `overlay` | reserved for a picture-in-picture replay alongside the live feed | — |

The worker refuses a `cut` insertion when the pipeline is unhealthy or running
below the safe speed threshold, so a replay can never leave you off air.

## Verified behaviour

Live run against a local RTMP sink (demo clip, 720p30):

```
[system] Replay capture requested for SIX
[system] Replay capture scheduled for SIX (in 1s)
[system] Replay clip ready: replay-six-1791109239018.mp4 (16.7s)
[system] Cutting to replay for 17.2s
[ffmpeg] Restarting pipeline: replay insertion     → then back to live, stream stays CONNECTED
```

Result: a 16.65 s / 3.3 MB clip on disk, a `replay_clips` row
(`eventType = SIX`, `durationSeconds = 16.7`, `inserted = true`) and the
broadcast still running afterwards.

## Operational notes

- Clips are written to `REPLAY_DIR` (default `<repo>/.runtime/replay`,
  `/app/.runtime/replay` in Docker). Put it on fast local disk — 24 × 5 s
  segments at 1.5 Mbps is roughly 20 MB, but the concat pass re-encodes.
- The ring is a fixed wrap (`segment_wrap 24`), so disk use is bounded; old
  segments are overwritten automatically.
- Capture failures (a missing ring, a busy disk) are logged and swallowed: the
  live broadcast always wins.
- Because clips are re-encoded, the clip inherits the output resolution and the
  scoreboard overlay that was on screen at the time.
- Add the directory to your backup/pruning policy — archived clips are the only
  thing here that grows without bound.

## Tests

- `stream-worker/src/replay/__tests__/replayBuffer.test.ts` — gating (disabled,
  wrong event type, duplicates), clip building from a real segment ring,
  slow-motion audio chaining (`atempoChain`), `cut` mode + unhealthy pipeline,
  and graceful degradation when the ring is empty.
- `backend/src/__tests__/realtime.test.ts` — “replay capture triggers”: a SIX
  sends `replay:capture` to the stream-worker when replays are enabled, and
  nothing is sent when they are not.
