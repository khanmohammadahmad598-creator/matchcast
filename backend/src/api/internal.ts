import { Router } from 'express';
import { z } from 'zod';
import { requireWorkerToken } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  hasOpenSession,
  updateInputStatus,
  updateStreamStatus,
  updateWorkerStatus,
} from '../services/streamService';
import { registerTtsAudio, saveCommentary, updateCommentaryTts } from '../services/commentaryService';
import { settings } from '../services/settings';
import { getLiveMatchId, getSnapshot } from '../services/matchService';
import { prisma } from '../db/prisma';
import { realtime } from '../realtime/io';
import { logger } from '../core/logger';
import { getGraphicsSettings } from '../services/graphicsService';
import type { InputStatus, StreamStatus, WorkerStatus } from '@matchcast/shared';

/**
 * Internal API consumed by stream-worker / graphics-worker.
 * Authenticated with the shared WORKER_TOKEN header, never exposed publicly.
 */
export const internalRouter: Router = Router();

internalRouter.use(requireWorkerToken);

const streamStatusSchema = z.object({
  running: z.boolean(),
  state: z.string(),
  pipelineGeneration: z.number(),
  uptimeSeconds: z.number(),
  input: z.record(z.unknown()),
  output: z.record(z.unknown()),
  fps: z.number(),
  bitrateKbps: z.number(),
  speed: z.number(),
  droppedFrames: z.number(),
  cpuPercent: z.number().optional(),
  lastError: z.string().nullable().optional(),
});

internalRouter.post('/stream/status', validate(streamStatusSchema), (req, res) => {
  updateStreamStatus(req.body as unknown as StreamStatus);
  updateInputStatus(req.body.input as unknown as InputStatus);
  res.json({ ok: true });
});

const workerStatusSchema = z.object({
  name: z.string(),
  online: z.boolean(),
  pid: z.number().optional(),
  uptimeSeconds: z.number(),
  details: z.record(z.unknown()).optional(),
});

internalRouter.post('/worker/status', validate(workerStatusSchema), (req, res) => {
  const status = { ...(req.body as unknown as WorkerStatus), updatedAt: new Date().toISOString() };
  updateWorkerStatus(status);
  res.json({ ok: true });
});

const logSchema = z.object({
  level: z.string(),
  source: z.string(),
  message: z.string(),
  meta: z.record(z.unknown()).nullable().optional(),
});

internalRouter.post('/logs', validate(logSchema), (req, res) => {
  const { level, source, message, meta } = req.body as {
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    source: 'stream-worker' | 'graphics-worker' | 'ffmpeg' | 'ai' | 'tts' | 'youtube' | 'system';
    message: string;
    meta?: Record<string, unknown> | null;
  };
  logger[level === 'DEBUG' ? 'debug' : level === 'WARN' ? 'warn' : level === 'ERROR' ? 'error' : 'info'](
    source,
    message,
    meta ?? null,
  );
  res.json({ ok: true });
});

const commentarySchema = z.object({
  matchId: z.string().optional(),
  text: z.string().min(1).max(1000),
  language: z.string(),
  style: z.string(),
  eventType: z.string().nullable().optional(),
  provider: z.string(),
});

internalRouter.post('/commentary', validate(commentarySchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof commentarySchema>;
    const matchId = body.matchId ?? (await getLiveMatchId());
    if (!matchId) return void res.status(404).json({ error: 'No match' });
    const item = await saveCommentary({
      matchId,
      text: body.text,
      language: body.language,
      style: body.style,
      eventType: body.eventType ?? null,
      provider: body.provider,
      ttsStatus: 'SYNTHESISING',
    });
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
});

const commentaryPatchSchema = z.object({
  id: z.string(),
  ttsStatus: z.string().optional(),
  audioUrl: z.string().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  spoken: z.boolean().optional(),
});

internalRouter.patch('/commentary', validate(commentaryPatchSchema), async (req, res, next) => {
  try {
    const item = await updateCommentaryTts(req.body.id, req.body);
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

const ttsAudioSchema = z.object({
  commentaryId: z.string().nullable().optional(),
  provider: z.string(),
  voice: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  text: z.string(),
  cacheKey: z.string(),
  filePath: z.string(),
  format: z.string(),
  durationMs: z.number().nullable().optional(),
  sizeBytes: z.number().nullable().optional(),
});

internalRouter.post('/tts-audio', validate(ttsAudioSchema), async (req, res, next) => {
  try {
    await registerTtsAudio(req.body);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const replayClipSchema = z.object({
  matchId: z.string(),
  eventType: z.string(),
  filePath: z.string(),
  durationSeconds: z.number(),
  inserted: z.boolean().optional(),
});

internalRouter.post('/replay-clip', validate(replayClipSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof replayClipSchema>;
    const clip = await prisma.replayClip.create({
      data: {
        matchId: body.matchId,
        eventType: body.eventType as never,
        filePath: body.filePath,
        durationSeconds: body.durationSeconds,
        inserted: body.inserted ?? false,
      },
    });
    realtime.replayClip({
      id: clip.id,
      matchId: clip.matchId,
      eventType: clip.eventType as never,
      filePath: clip.filePath,
      durationSeconds: clip.durationSeconds,
      inserted: clip.inserted,
      createdAt: clip.createdAt.toISOString(),
    });
    res.status(201).json({ clip });
  } catch (err) {
    next(err);
  }
});

/** Workers pull their full configuration at boot (and on reconnect). */
internalRouter.get('/bootstrap', async (_req, res, next) => {
  try {
    const [ai, tts, audio, graphics, output, input, replay] = await Promise.all([
      settings.ai(),
      settings.tts(),
      settings.audio(),
      getGraphicsSettings(),
      settings.output(),
      settings.input(),
      settings.replay(),
    ]);
    const matchId = await getLiveMatchId();
    const shouldRun = await hasOpenSession();
    res.json({
      stream: { shouldRun },
      ai,
      tts,
      audio,
      graphics,
      output,
      input,
      replay,
      snapshot: matchId ? await getSnapshot(matchId) : null,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});
