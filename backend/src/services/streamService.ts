import { prisma } from '../db/prisma';
import { logger } from '../core/logger';
import { realtime } from '../realtime/io';
import { settings } from './settings';
import type {
  AudioMixSettings,
  GraphicsSettings,
  InputStatus,
  MatchEvent,
  ReplaySettings,
  StreamStatus,
  TtsSettings,
  WorkerStatus,
} from '@matchcast/shared';

/**
 * The backend is the control plane: it owns intent ("stream should be running")
 * and caches the live status the stream-worker reports back. It never talks to
 * FFmpeg directly.
 */

let currentStatus: StreamStatus = idleStatus();
let activeSessionId: string | null = null;
const workers = new Map<string, WorkerStatus>();

export function idleStatus(): StreamStatus {
  return {
    running: false,
    state: 'IDLE',
    pipelineGeneration: 0,
    uptimeSeconds: 0,
    input: {
      kind: 'demo',
      state: 'IDLE',
      url: '',
      bitrateKbps: 0,
      fps: 0,
      droppedFrames: 0,
      reconnectCount: 0,
      lastError: null,
      updatedAt: new Date().toISOString(),
    },
    output: {
      target: 'youtube',
      state: 'IDLE',
      bitrateKbps: 0,
      fps: 0,
      reconnectCount: 0,
      lastError: null,
      updatedAt: new Date().toISOString(),
    },
    fps: 0,
    bitrateKbps: 0,
    speed: 0,
    droppedFrames: 0,
    cpuPercent: 0,
    lastError: null,
    updatedAt: new Date().toISOString(),
  };
}

export function getStatus(): StreamStatus {
  return currentStatus;
}

export function getWorkers(): WorkerStatus[] {
  return [...workers.values()];
}

export function updateWorkerStatus(status: WorkerStatus): void {
  workers.set(status.name, status);
  realtime.workerStatus(status);
}

/** stream-worker pushes its live status; we cache, broadcast and persist errors. */
export function updateStreamStatus(next: StreamStatus): void {
  const prev = currentStatus;
  currentStatus = { ...next, updatedAt: new Date().toISOString() };
  realtime.streamStatus(currentStatus);

  if (next.lastError && next.lastError !== prev.lastError) {
    logger.error('youtube', next.lastError, { pipelineGeneration: next.pipelineGeneration });
    if (activeSessionId) {
      void prisma.streamSession
        .update({ where: { id: activeSessionId }, data: { lastError: next.lastError.slice(0, 900) } })
        .catch(() => undefined);
    }
  }
}

export function updateInputStatus(next: InputStatus): void {
  currentStatus = {
    ...currentStatus,
    input: next,
    updatedAt: new Date().toISOString(),
  };
  realtime.inputStatus(next);
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

/**
 * A session left open by a crash is only considered "should be running" for a
 * limited window - otherwise a long-dead broadcast could auto-start days later.
 */
const AUTO_RESUME_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * True when a stream session was still open at shutdown (crash / restart).
 * The stream-worker uses this to auto-resume the broadcast it was running.
 */
export async function hasOpenSession(): Promise<boolean> {
  const open = await prisma.streamSession.findFirst({
    where: { endedAt: null, startedAt: { gte: new Date(Date.now() - AUTO_RESUME_MAX_AGE_MS) } },
    select: { id: true },
    orderBy: { startedAt: 'desc' },
  });
  return Boolean(open);
}

/**
 * Close sessions that were left open by an unrecoverable shutdown so the
 * history stays meaningful. Called once at backend boot.
 */
export async function closeOrphanedSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - AUTO_RESUME_MAX_AGE_MS);
  const { count } = await prisma.streamSession.updateMany({
    where: { endedAt: null, startedAt: { lt: cutoff } },
    data: { endedAt: new Date(), endReason: 'CRASHED' },
  });
  return count;
}

export class StreamControlError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function startStream(actorId?: string): Promise<{ started: boolean; sessionId: string | null }> {
  const input = await settings.input();
  const output = await settings.output();

  if (!input.rightsAttested) {
    throw new StreamControlError(
      'Input source is not rights-attested. Confirm you own or are licensed to broadcast this feed.',
      403,
    );
  }

  if (!realtime.command('stream-worker', { type: 'stream:start' })) {
    throw new StreamControlError('stream-worker is offline - start it with `npm run dev:stream`', 503);
  }

  // Push the latest settings to the worker so a freshly restarted worker is in sync.
  realtime.command('stream-worker', { type: 'input:set', payload: input });
  realtime.command('stream-worker', {
    type: 'audio:mix',
    payload: await settings.audio(),
  } as { type: 'audio:mix'; payload: AudioMixSettings });
  realtime.command('stream-worker', {
    type: 'tts:settings',
    payload: await settings.tts(),
  } as { type: 'tts:settings'; payload: TtsSettings });
  realtime.command('stream-worker', {
    type: 'replay:settings',
    payload: await settings.replay(),
  } as { type: 'replay:settings'; payload: ReplaySettings });

  const session = await prisma.streamSession.create({
    data: {
      inputKind: input.kind as never,
      inputUrl: input.url.slice(0, 500),
      outputTarget: 'youtube-rtmp',
      resolution: output.resolution,
      fps: output.fps,
      videoBitrateKbps: output.videoBitrateKbps,
      audioBitrateKbps: output.audioBitrateKbps,
      ...(actorId ? {} : {}),
    },
  });
  activeSessionId = session.id;
  currentStatus = { ...currentStatus, running: true, state: 'CONNECTING', updatedAt: new Date().toISOString() };
  realtime.streamStatus(currentStatus);
  logger.info('youtube', 'Stream start requested', {
    sessionId: session.id,
    inputKind: input.kind,
    resolution: output.resolution,
    fps: output.fps,
  });
  return { started: true, sessionId: session.id };
}

export async function stopStream(reason = 'STOPPED'): Promise<void> {
  realtime.command('stream-worker', { type: 'stream:stop' });
  if (activeSessionId) {
    await prisma.streamSession
      .update({
        where: { id: activeSessionId },
        data: { endedAt: new Date(), endReason: reason as never },
      })
      .catch(() => undefined);
    activeSessionId = null;
  }
  currentStatus = { ...idleStatus(), updatedAt: new Date().toISOString() };
  realtime.streamStatus(currentStatus);
  logger.info('youtube', 'Stream stop requested', { reason });
}

export async function restartStream(reason = 'manual'): Promise<void> {
  if (!realtime.command('stream-worker', { type: 'stream:restart', payload: { reason } })) {
    throw new StreamControlError('stream-worker is offline', 503);
  }
  logger.info('youtube', 'Stream restart requested', { reason });
  if (activeSessionId) {
    await prisma.streamSession
      .update({ where: { id: activeSessionId }, data: { reconnectCount: { increment: 1 } } })
      .catch(() => undefined);
  }
}

export async function reconnectOutput(): Promise<void> {
  if (!realtime.command('stream-worker', { type: 'output:reconnect' })) {
    throw new StreamControlError('stream-worker is offline', 503);
  }
  logger.info('youtube', 'Output reconnect requested');
}

export async function setInput(next: {
  kind: string;
  url: string;
  rightsAttested: boolean;
  rightsNote?: string | null;
}, actorId?: string): Promise<void> {
  await settings.setInput(next);
  if (next.rightsAttested) {
    await prisma.authorizedSource.create({
      data: {
        kind: next.kind as never,
        urlPattern: next.url.slice(0, 500),
        rightsNote: next.rightsNote ?? null,
        attestedById: actorId ?? null,
        active: true,
      },
    });
    logger.info('system', 'Authorized source attested', {
      kind: next.kind,
      urlPattern: next.url.slice(0, 60),
      actorId,
    });
  }
  realtime.command('stream-worker', { type: 'input:set', payload: next });
}

export function pushGraphicsSettings(gs: GraphicsSettings): void {
  realtime.command('graphics-worker', { type: 'graphics:settings', payload: gs });
}

export function pushAudioMix(mix: AudioMixSettings): void {
  realtime.command('stream-worker', { type: 'audio:mix', payload: mix });
}

export function pushTtsSettings(tts: TtsSettings): void {
  realtime.command('stream-worker', { type: 'tts:settings', payload: tts });
}

export function pushReplaySettings(replay: ReplaySettings): void {
  realtime.command('stream-worker', { type: 'replay:settings', payload: replay });
}

/** Operator-triggered commentary (does not depend on match data). */
export function speakText(text: string, language?: string, priority = 80): boolean {
  return realtime.command('stream-worker', {
    type: 'tts:speak',
    payload: { text, language, priority },
  });
}

export function flashGraphic(title: string, subtitle?: string, ms?: number): boolean {
  return realtime.command('graphics-worker', { type: 'graphics:flash', payload: { title, subtitle, ms } });
}

/**
 * Trigger a rolling-buffer capture for a real scoring event.
 *
 * The control plane owns the operator's trigger list and knows whether the
 * stream-worker is online, so it decides *when* a capture happens; the worker
 * decides *how* (segment ring, slow motion, cut/insert). Capture is also
 * requested when `mode === 'off'` - that mode archives clips without ever
 * interrupting the live feed, which costs no added latency.
 */
export async function maybeCaptureReplay(event: MatchEvent): Promise<boolean> {
  try {
    const replay = await settings.replay();
    if (!replay.enabled) return false;
    if (!replay.triggerEvents.includes(event.type)) return false;

    const sent = realtime.command('stream-worker', { type: 'replay:capture', payload: { event } });
    if (!sent) {
      logger.debug('system', `Replay trigger ${event.type} skipped - stream-worker offline`);
    } else {
      logger.info('system', `Replay capture requested for ${event.type}`);
    }
    return sent;
  } catch (err) {
    logger.warn('system', 'Replay trigger failed', { error: (err as Error).message });
    return false;
  }
}
