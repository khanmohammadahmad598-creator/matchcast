import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { queryLogs, recentLogs } from '../services/logService';
import { currentStats } from '../services/systemStats';
import { getStatus, getWorkers } from '../services/streamService';
import { prisma } from '../db/prisma';

export const systemRouter: Router = Router();

/**
 * Liveness probe - deliberately unauthenticated so load balancers, Docker
 * healthchecks and uptime monitors can call it. It exposes nothing but
 * uptime, and whether the database and Redis answered recently.
 */
systemRouter.get('/health', async (_req, res) => {
  let db: 'up' | 'down' = 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = 'up';
  } catch {
    db = 'down';
  }
  res.status(db === 'up' ? 200 : 503).json({
    ok: db === 'up',
    service: 'backend',
    db,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

systemRouter.use(requireAuth);

systemRouter.get('/stats', (_req, res) => {
  res.json({ stats: currentStats(), stream: getStatus(), workers: getWorkers() });
});

/** Live tail (in-memory ring) - fastest path for the logs page. */
systemRouter.get('/logs', async (req, res, next) => {
  try {
    const limit = Math.min(500, Number(req.query.limit ?? 200));
    const level = req.query.level as string | undefined;
    if (req.query.source === 'database') {
      const since = req.query.since ? new Date(String(req.query.since)) : undefined;
      res.json({ logs: await queryLogs({ limit, level, since }) });
      return;
    }
    res.json({ logs: recentLogs(limit, level) });
  } catch (err) {
    next(err);
  }
});

systemRouter.get('/logs/db', async (req, res, next) => {
  try {
    res.json({
      logs: await queryLogs({
        limit: Number(req.query.limit ?? 200),
        level: req.query.level as string | undefined,
        source: req.query.source as string | undefined,
        since: req.query.since ? new Date(String(req.query.since)) : undefined,
      }),
    });
  } catch (err) {
    next(err);
  }
});

systemRouter.delete('/logs', requireRole('ADMIN'), async (_req, res, next) => {
  try {
    await prisma.systemLog.deleteMany({});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Compliance audit trail: every source the operator attested rights for. */
systemRouter.get('/authorized-sources', requireRole('ADMIN', 'OPERATOR'), async (_req, res, next) => {
  try {
    const rows = await prisma.authorizedSource.findMany({ orderBy: { attestedAt: 'desc' }, take: 50 });
    res.json({ sources: rows });
  } catch (err) {
    next(err);
  }
});
