import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { settings } from '../services/settings';
import {
  getStatus,
  getWorkers,
  pushAudioMix,
  pushReplaySettings,
  reconnectOutput,
  restartStream,
  setInput,
  startStream,
  stopStream,
} from '../services/streamService';
import { prisma } from '../db/prisma';
import { syncOverlaySize } from '../services/graphicsService';
import { audioMixSchema, replaySettingsSchema, streamInputSchema, streamOutputSchema } from '@matchcast/shared';

export const streamingRouter: Router = Router();

streamingRouter.use(requireAuth);

streamingRouter.get('/status', (_req, res) => {
  res.json({ status: getStatus(), workers: getWorkers() });
});

streamingRouter.post('/start', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    res.json(await startStream(req.user?.id));
  } catch (err) {
    next(err);
  }
});

streamingRouter.post('/stop', requireRole('ADMIN', 'OPERATOR'), async (_req, res, next) => {
  try {
    await stopStream('STOPPED');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

streamingRouter.post('/restart', requireRole('ADMIN', 'OPERATOR'), async (_req, res, next) => {
  try {
    await restartStream('manual-restart');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

streamingRouter.post('/reconnect', requireRole('ADMIN', 'OPERATOR'), async (_req, res, next) => {
  try {
    await reconnectOutput();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------- input ---------------------------- */

streamingRouter.get('/input', async (_req, res, next) => {
  try {
    res.json({ input: await settings.input() });
  } catch (err) {
    next(err);
  }
});

streamingRouter.put('/input', requireRole('ADMIN', 'OPERATOR'), validate(streamInputSchema), async (req, res, next) => {
  try {
    const body = req.body as { kind: string; url: string; rightsAttested: boolean; rightsNote?: string | null };
    await setInput(body, req.user?.id);
    res.json({ input: await settings.input() });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ output ---------------------------- */

/**
 * Output settings. The stream key is NEVER returned - the dashboard only sees
 * whether it is configured on the stream-worker (via YOUTUBE_STREAM_KEY env).
 */
streamingRouter.get('/output', async (_req, res, next) => {
  try {
    const output = await settings.output();
    res.json({
      output: {
        ...output,
        rtmpUrl: process.env.YOUTUBE_RTMP_URL ?? output.rtmpUrl,
        streamKeyConfigured: Boolean(process.env.YOUTUBE_STREAM_KEY),
      },
    });
  } catch (err) {
    next(err);
  }
});

streamingRouter.put('/output', requireRole('ADMIN', 'OPERATOR'), validate(streamOutputSchema), async (req, res, next) => {
  try {
    const next = await settings.setOutput(req.body);
    await syncOverlaySize(next.resolution);
    res.json({ output: next });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------- audio ---------------------------- */

streamingRouter.get('/audio', async (_req, res, next) => {
  try {
    res.json({ audio: await settings.audio() });
  } catch (err) {
    next(err);
  }
});

streamingRouter.put('/audio', requireRole('ADMIN', 'OPERATOR'), validate(audioMixSchema), async (req, res, next) => {
  try {
    const next = await settings.setAudio(req.body);
    pushAudioMix(next);
    res.json({ audio: next });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ replay ---------------------------- */

streamingRouter.get('/replay', async (_req, res, next) => {
  try {
    res.json({ replay: await settings.replay() });
  } catch (err) {
    next(err);
  }
});

streamingRouter.put('/replay', requireRole('ADMIN', 'OPERATOR'), validate(replaySettingsSchema), async (req, res, next) => {
  try {
    const next = await settings.setReplay(req.body);
    pushReplaySettings(next);
    res.json({ replay: next });
  } catch (err) {
    next(err);
  }
});

/* ----------------------------- sessions --------------------------- */

streamingRouter.get('/sessions', async (_req, res, next) => {
  try {
    const sessions = await prisma.streamSession.findMany({ orderBy: { startedAt: 'desc' }, take: 30 });
    res.json({ sessions });
  } catch (err) {
    next(err);
  }
});
