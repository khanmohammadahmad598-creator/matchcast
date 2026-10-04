# Troubleshooting

Everything below is ordered by how often it actually happens.

## The stream will not start

| Symptom | Cause | Fix |
| --- | --- | --- |
| `403 … rights-attested` | Compliance gate | Tick **I hold the rights to this feed** on the Streaming page and save |
| `503 stream-worker is offline` | Worker not connected | `npm run dev:stream`, then check `GET /api/stream/status → workers[]` |
| `YOUTUBE_STREAM_KEY (or RTMP_TEST_URL) is not configured` | No output target | Set `YOUTUBE_STREAM_KEY` (live) or `RTMP_TEST_URL` (local loopback) in `stream-worker/.env` |
| `ffmpeg exited with code 145` | RTMP connect refused | Your endpoint is not listening; check the URL/port/firewall |
| `ffmpeg exited with code 8` | Bad ffmpeg option | The filter graph is built in `stream-worker/src/pipeline/ffmpegArgs.ts`; run with `LOG_LEVEL=DEBUG` and copy the logged `argv:` line to reproduce |
| `ffmpeg exited with code 234` | A filter output pad used twice | Enable either the preview **or** reuse `[vout]`; the builder already `split`s when the preview is on |
| Immediately restarts forever | Backoff storm | Read `lastError`; every restart is logged with its exit code and the ffmpeg stderr tail |

Useful: `LOG_LEVEL=DEBUG` prints the exact ffmpeg command line (stream key
redacted) before every launch.

## No video / black frames

1. `ffprobe` the input yourself — if the source is broken, nothing downstream helps.
2. Check `.runtime/preview/index.m3u8` — if the preview is fine but YouTube is
   black, the problem is on the ingest side (key, URL, latency setting).
3. If the preview is black but FPS/bitrate look healthy, the graphics FIFO may be
   stalled: restart `graphics-worker`. The pipeline degrades to a text score bug
   rather than going black, so a *fully* black frame means the input itself.

## Low bitrate / bad quality

* Raise `videoBitrateKbps` (720p: 2500–4500; 1080p: 4500–9000).
* A **very** simple source (a flat colour clip) cannot spend the bits — this is
  x264 behaving correctly, not a bug. Verify with a detailed clip.
* Check `speed` in `GET /api/stream/status`: below `1.0` means the CPU cannot keep
  up. Lower the resolution/fps, switch `preset` to `ultrafast`, or enable a
  hardware encoder (`HW_ACCEL=nvidia|vaapi|qsv`).

## Audio problems

| Symptom | Fix |
| --- | --- |
| No commentary audio | TTS provider missing → the offline mock is used (tone beeps). Configure a provider key, or check `/api/tts/voices` |
| Commentary too loud/quiet | Audio mixer: `commentaryVolume`, plus ducking (`duckingEnabled`, `duckAmount`) |
| Original feed not ducking | Ducking only applies while a line is playing; verify `ttsStatus: PLAYED` in `/api/commentary/history` |
| Echo / doubled audio | Your input already contains commentary; lower `originalVolume` |

## Scoreboard not updating

1. `GET /api/match/<id>/state` — if the backend snapshot is correct, the problem
   is between the backend and the workers.
2. Restart `graphics-worker`: it renders from the latest snapshot it received.
3. If the overlay canvas size does not match the encoder output, frames are
   rejected. The backend keeps `graphics.overlayWidth/Height` in sync with the
   output resolution (`syncOverlaySize()`); changing resolution in the UI updates
   it automatically.
4. Kill `graphics-worker` entirely: the stream must keep running on the degraded
   text bug. If it stops instead, that is a bug worth reporting.

## Socket.IO not updating the dashboard

* The Vite dev server proxies `/socket.io` to `:4000` — open the app on the Vite
  port (5173), not on the backend port.
* Behind nginx you must forward the `Upgrade`/`Connection` headers (see
  `docker/nginx.conf`).
* With multiple backend replicas, set `REDIS_URL` on all of them, otherwise each
  replica only broadcasts to its own connected clients.

## Database

```bash
cd backend
npx prisma migrate dev        # create/apply a migration during development
npx prisma migrate deploy     # apply migrations in production
npm run db:seed               # demo data (safe to re-run)
npx prisma studio             # browse the data
psql "$DATABASE_URL" -c "select id, \"startedAt\", \"endedAt\", \"endReason\" from stream_sessions order by \"startedAt\" desc limit 10;"
```

## “Too many open files” / FIFO errors

The graphics and audio FIFOs are reopened automatically when a writer
disappears. Persistent `EPIPE` errors mean the reader (ffmpeg) died — check the
pipeline state first.

## Where the logs are

* Live tail: **Logs** page in the dashboard (level chips + search).
* Persisted: `GET /api/system/logs/db`.
* Worker stdout: `docker compose logs -f stream-worker graphics-worker`, or the
  terminal running `npm run dev`.
