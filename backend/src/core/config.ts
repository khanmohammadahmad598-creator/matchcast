import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

/**
 * All configuration is validated once at boot. Missing/invalid values fail fast
 * instead of exploding halfway through a live broadcast.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  REDIS_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .default('true')
    .transform((v) => v === 'true'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  SESSION_COOKIE_NAME: z.string().default('matchcast_token'),
  COOKIE_SECURE: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((v) => v === 'true'),

  /** Shared secret that workers use to authenticate their socket connection. */
  WORKER_TOKEN: z.string().min(12, 'WORKER_TOKEN must be at least 12 characters'),
  /** API key an authorised live-scoring provider uses to POST /api/match/update. */
  SCORING_API_KEY: z.string().min(12).optional(),

  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),
  ALLOW_ANY_ORIGIN: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((v) => v === 'true'),

  /** Where ffmpeg/video artefacts, uploads, HLS preview and TTS cache live. */
  MEDIA_DIR: z.string().default(path.resolve(process.cwd(), '../.runtime/media')),
  PREVIEW_DIR: z.string().default(path.resolve(process.cwd(), '../.runtime/preview')),
  TTS_DIR: z.string().default(path.resolve(process.cwd(), '../.runtime/tts')),
  FRAMES_DIR: z.string().default(path.resolve(process.cwd(), '../.runtime/frames')),
  /** Random path segment required to read the HLS preview (keeps it off the public web). */
  PREVIEW_TOKEN: z.string().default('preview'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().default(600),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().default(10),

  // AI + TTS provider keys (all optional - system degrades gracefully without them)
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  GOOGLE_TTS_API_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n[config] Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
};

export type Config = typeof config;

/**
 * Resolves a directory from env, creating it if needed.
 * Keeps runtime artefacts inside the workspace/dev volume rather than the image.
 */
export function ensureDir(dir: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
