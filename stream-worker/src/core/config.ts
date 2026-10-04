import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),

  BACKEND_URL: z.string().default('http://127.0.0.1:4000'),
  WORKER_TOKEN: z.string().min(8),
  WORKER_NAME: z.literal('stream-worker').default('stream-worker'),

  YOUTUBE_RTMP_URL: z.string().default('rtmps://a.rtmps.youtube.com/live2'),
  YOUTUBE_STREAM_KEY: z.string().optional(),

  FFMPEG_PATH: z.string().default('ffmpeg'),
  /** Shared with graphics-worker: named pipes for overlay frames + mixed audio. */
  FRAMES_DIR: z.string().default(path.resolve(process.cwd(), '../.runtime/frames')),
  TTS_DIR: z.string().default(path.resolve(process.cwd(), '../.runtime/tts')),
  PREVIEW_DIR: z.string().default(path.resolve(process.cwd(), '../.runtime/preview')),
  REPLAY_DIR: z.string().default(path.resolve(process.cwd(), '../.runtime/replay')),
  /** Local demo video used by demo mode (must be a video you own / are licensed for). */
  DEMO_VIDEO: z.string().default(path.resolve(process.cwd(), '../demo-assets/demo-match.mp4')),

  GRAPHICS_FIFO_NAME: z.string().default('graphics.rgba'),
  AUDIO_FIFO_NAME: z.string().default('commentary.pcm'),

  PREVIEW_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .default('true')
    .transform((v) => v === 'true'),
  PREVIEW_TOKEN: z.string().default('preview'),

  /** Hardware acceleration: auto detects nvenc / vaapi / qsv. */
  HW_ACCEL: z.enum(['auto', 'off', 'nvidia', 'vaapi', 'qsv']).default('auto'),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-3-5-haiku-latest'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),

  ELEVENLABS_API_KEY: z.string().optional(),
  GOOGLE_TTS_API_KEY: z.string().optional(),

  /** Fail-safe: restart the pipeline if ffmpeg produces no progress for N seconds. */
  PIPELINE_WATCHDOG_SECONDS: z.coerce.number().int().default(20),
  MAX_RESTART_BACKOFF_SECONDS: z.coerce.number().int().default(30),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('[stream-worker] Invalid configuration:\n' + parsed.error.issues.map((i) => ` - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

export const config = {
  ...parsed.data,
  framesDir: parsed.data.FRAMES_DIR,
  graphicsFifo: path.join(parsed.data.FRAMES_DIR, parsed.data.GRAPHICS_FIFO_NAME),
  audioFifo: path.join(parsed.data.FRAMES_DIR, parsed.data.AUDIO_FIFO_NAME),
};

for (const dir of [config.FRAMES_DIR, config.TTS_DIR, config.PREVIEW_DIR, config.REPLAY_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

export function rtmpTarget(): { url: string; key: string; full: string } {
  const url = config.YOUTUBE_RTMP_URL.replace(/\/+$/, '');
  const key = config.YOUTUBE_STREAM_KEY ?? '';
  return { url, key, full: key ? `${url}/${key}` : url };
}

/** Never let the stream key reach a log line or an API response. */
export function maskTarget(): string {
  const { url, key } = rtmpTarget();
  if (!key) return `${url}/<missing-stream-key>`;
  return `${url}/${key.slice(0, 2)}***${key.slice(-2)}`;
}

/**
 * Redact the stream key from an arbitrary string (used for debug logging of
 * the exact ffmpeg argv - the key must never reach logs or the dashboard).
 */
export function redactStreamKey(text: string): string {
  let out = text;
  const key = (process.env.YOUTUBE_STREAM_KEY ?? '').trim();
  if (key) out = out.split(key).join('<redacted-stream-key>');
  // Belt and braces: mask the trailing path segment of any rtmp(s):// URL so a
  // key can never reach a log even if it was passed outside the environment.
  return out.replace(/(rtmps?:\/\/\S*)\/[A-Za-z0-9._-]{8,}(?=\s|$)/g, '$1/<redacted-stream-key>');
}

/** Resolve the ffmpeg binary: env -> ffmpeg-static (dev) -> PATH. */
export function resolveFfmpeg(): string {
  if (config.FFMPEG_PATH && config.FFMPEG_PATH !== 'ffmpeg') return config.FFMPEG_PATH;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static') as string | null;
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* optional dev dependency */
  }
  return 'ffmpeg';
}
