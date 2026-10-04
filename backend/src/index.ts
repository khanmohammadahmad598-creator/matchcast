import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { config, ensureDir } from './core/config';
import { logger } from './core/logger';
import { initRedis } from './core/redis';
import { connectDatabase, prisma } from './db/prisma';
import { initRealtime } from './realtime/io';
import { initLogService } from './services/logService';
import { startStatsBroadcast } from './services/systemStats';
import { seedTemplates, syncOverlaySize } from './services/graphicsService';
import { attachUser } from './middleware/auth';
import { settings } from './services/settings';
import { closeOrphanedSessions } from './services/streamService';
import { errorHandler, notFound } from './middleware/error';
import { apiRouter } from './api';
import bcrypt from 'bcryptjs';

export async function createServer() {
  const app = express();

  // ---------------------------------------------------------------- security
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: false, // the dashboard is served by its own origin
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: config.ALLOW_ANY_ORIGIN ? true : config.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(attachUser);

  app.use(
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: config.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      // Admin/API traffic from workers is not rate limited.
      skip: (req) => Boolean(req.headers['x-worker-token']),
    }),
  );

  // ------------------------------------------------------------------ static
  ensureDir(config.MEDIA_DIR);
  app.use('/media', express.static(config.MEDIA_DIR, { maxAge: '1h', fallthrough: true }));

  // HLS preview produced by the stream-worker, protected by a random path token.
  ensureDir(config.PREVIEW_DIR);
  app.use(
    `/api/preview/:token`,
    (req, res, next) => {
      if (req.params.token !== config.PREVIEW_TOKEN) return void res.status(404).end();
      next();
    },
    express.static(config.PREVIEW_DIR, {
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Access-Control-Allow-Origin', '*');
      },
    }),
  );

  // ------------------------------------------------------------------ routes
  app.use('/api', apiRouter);
  app.use('/api/*', notFound);
  app.use(errorHandler);

  const httpServer = http.createServer(app);
  initRealtime(httpServer);
  return { app, httpServer };
}

async function bootstrap() {
  initLogService();
  initRedis();
  await connectDatabase();
  await seedTemplates();
  await syncOverlaySize((await settings.output()).resolution);
  const orphaned = await closeOrphanedSessions();
  if (orphaned) logger.warn('system', `Closed ${orphaned} orphaned stream session(s) from a previous run`);

  // First-run convenience: create the default admin if the table is empty.
  if (process.env.SEED_ADMIN_ON_BOOT !== 'false') {
    const count = await prisma.user.count();
    if (count === 0) {
      const email = (process.env.DEFAULT_ADMIN_EMAIL ?? 'admin@matchcast.local').toLowerCase();
      const password = process.env.DEFAULT_ADMIN_PASSWORD ?? 'ChangeMeNow123!';
      await prisma.user.create({
        data: { email, name: 'Admin', passwordHash: await bcrypt.hash(password, 12), role: 'ADMIN' },
      });
      logger.warn('backend', `Seeded default admin ${email} - change the password immediately`, { email });
    }
  }

  const { httpServer } = await createServer();
  const port = config.PORT;
  httpServer.listen(port, config.HOST, () => {
    logger.info('backend', `MatchCast API listening on http://${config.HOST}:${port}`);
    logger.info('backend', `Environment: ${config.NODE_ENV}`);
    if (!process.env.YOUTUBE_STREAM_KEY) {
      logger.warn('youtube', 'YOUTUBE_STREAM_KEY is not set - the stream-worker will refuse to go live');
    }
  });

  startStatsBroadcast(2000);

  // -------------------------------------------------------- graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info('backend', `Received ${signal}, shutting down`);
    httpServer.close();
    try {
      await prisma.$disconnect();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

// Keep runtime dirs available for workers running on the same host.
for (const dir of [config.MEDIA_DIR, config.PREVIEW_DIR, config.TTS_DIR, config.FRAMES_DIR]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* non fatal */
  }
}

/**
 * Async errors must never take the control plane down, but they must also never
 * produce an infinite log -> emit -> error -> log loop. Identical messages are
 * therefore throttled to one entry per 30 seconds.
 */
const seenErrors = new Map<string, number>();

function reportProcessError(kind: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const key = `${kind}:${message.slice(0, 120)}`;
  const last = seenErrors.get(key) ?? 0;
  const now = Date.now();
  if (now - last < 30_000) return;
  seenErrors.set(key, now);
  logger.error('backend', `${kind}: ${message}`, {
    stack: err instanceof Error ? err.stack?.split('\n').slice(1, 4).join(' | ') : undefined,
  });
}

if (require.main === module) {
  bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => reportProcessError('Unhandled rejection', reason));
  process.on('uncaughtException', (err) => reportProcessError('Uncaught exception', err));
}

export { path };
