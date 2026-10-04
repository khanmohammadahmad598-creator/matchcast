import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),
  BACKEND_URL: z.string().default('http://127.0.0.1:4000'),
  WORKER_TOKEN: z.string().min(8),
  FRAMES_DIR: z.string().default(path.resolve(process.cwd(), '../.runtime/frames')),
  GRAPHICS_FIFO_NAME: z.string().default('graphics.rgba'),
  /** Output canvas size - must match the stream resolution. */
  OVERLAY_WIDTH: z.coerce.number().int().default(1920),
  OVERLAY_HEIGHT: z.coerce.number().int().default(1080),
  OVERLAY_FPS: z.coerce.number().int().default(15),
  MEDIA_DIR: z.string().default(path.resolve(process.cwd(), '../.runtime/media')),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('[graphics-worker] Invalid configuration:\n' + parsed.error.issues.map((i) => ` - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

export const config = {
  ...parsed.data,
  fifoPath: path.join(parsed.data.FRAMES_DIR, parsed.data.GRAPHICS_FIFO_NAME),
};

fs.mkdirSync(config.FRAMES_DIR, { recursive: true });
export { fs };
