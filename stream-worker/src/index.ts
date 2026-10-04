import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { config, maskTarget, rtmpTarget, resolveFfmpeg } from './core/config';
import { logger, setRemoteLogSink } from './core/logger';
import { backend } from './core/backendClient';
import { WorkerSocket } from './core/workerSocket';
import { InputManager } from './input/InputManager';
import { Pipeline, type PipelineStats } from './pipeline/Pipeline';
import { buildPipelineArgs } from './pipeline/ffmpegArgs';
import { detectEncoder, type EncodingChoice } from './pipeline/encoder';
import { AudioMixer } from './audio/AudioMixer';
import { TtsService } from './tts/TtsService';
import { CommentaryEngine } from './ai/CommentaryEngine';
import { OverlayInput } from './graphics/overlay';
import { ReplayBuffer, type ReplayClipResult } from './replay/ReplayBuffer';
import { installProcessGuards } from '@matchcast/shared';
import {
  EV,
  RESOLUTION_DIMENSIONS,
  type AudioMixSettings,
  type ConnectionState,
  type GraphicsSettings,
  type MatchEvent,
  type ReplaySettings,
  type ScoreSnapshot,
  type StreamOutputSettings,
  type StreamStatus,
  type TtsSettings,
  type WorkerCommand,
} from '@matchcast/shared';

/* ------------------------------------------------------------------ */
/* State                                                              */
/* ------------------------------------------------------------------ */

const state: {
  snapshot: ScoreSnapshot | null;
  output: StreamOutputSettings;
  graphics: GraphicsSettings;
  replay: ReplaySettings;
  replayInsertion: { path: string; endsAt: number } | null;
  startedAt: number | null;
  lastError: string | null;
  stats: PipelineStats | null;
  outputState: ConnectionState;
  outputReconnects: number;
} = {
  snapshot: null,
  output: {
    rtmpUrl: config.YOUTUBE_RTMP_URL,
    resolution: '1080p',
    fps: 30,
    videoBitrateKbps: 6000,
    audioBitrateKbps: 128,
    preset: 'veryfast',
    keyframeIntervalSeconds: 2,
  },
  graphics: {
    templateId: 'cricket-modern',
    accentColor: '#00d09c',
    backgroundColor: '#0b1120',
    textColor: '#ffffff',
    fontFamily: 'Inter, Arial, sans-serif',
    showLiveBadge: true,
    showSponsorBanner: false,
    lowerThirdVisible: false,
    introVisible: false,
    outroVisible: false,
    scoreboardPosition: 'bottom-left',
    opacity: 0.96,
    overlayFps: 15,
    overlayWidth: 1920,
    overlayHeight: 1080,
  },
  replay: {
    enabled: false,
    preRollSeconds: 8,
    postRollSeconds: 4,
    mode: 'off',
    playbackRate: 0.6,
    maxLatencySeconds: 6,
    triggerEvents: ['SIX', 'WICKET', 'MILESTONE'],
  },
  replayInsertion: null,
  startedAt: null,
  lastError: null,
  stats: null,
  outputState: 'IDLE',
  outputReconnects: 0,
};

const inputManager = new InputManager();
const overlay = new OverlayInput(config.graphicsFifo, path.join(config.FRAMES_DIR, 'score.txt'));
const mixer = new AudioMixer(config.audioFifo);
const tts = new TtsService(mixer, backend);

let encoding: EncodingChoice = { videoEncoder: 'libx264', hwAccel: 'off', preset: 'veryfast' };

const engine = new CommentaryEngine(tts, backend, () => state.snapshot);

let replay: ReplayBuffer | null = null;

/* ------------------------------------------------------------------ */
/* Output target resolution                                            */
/* ------------------------------------------------------------------ */

/**
 * YouTube Live is the default target. For local testing you can point the
 * worker at any RTMP endpoint (e.g. a local nginx-rtmp / SRS server) using
 * RTMP_TEST_URL - no YouTube account required.
 */
function resolveOutputTarget(): { target: string; ok: boolean; reason?: string } {
  const { key } = rtmpTarget();
  if (key) return { target: rtmpTarget().full, ok: true };
  const test = process.env.RTMP_TEST_URL;
  if (test) {
    logger.warn('youtube', 'YOUTUBE_STREAM_KEY missing - using RTMP_TEST_URL (local testing only)');
    return { target: test, ok: true };
  }
  return { target: '', ok: false, reason: 'YOUTUBE_STREAM_KEY (or RTMP_TEST_URL) is not configured' };
}

/* ------------------------------------------------------------------ */
/* FFmpeg argument construction                                        */
/* ------------------------------------------------------------------ */

function buildArgs(): string[] {
  const dims = RESOLUTION_DIMENSIONS[state.output.resolution] ?? RESOLUTION_DIMENSIONS['1080p'];
  const { target } = resolveOutputTarget();
  const graphicsReady = overlay.hasWriter();

  let inputArgs: string[];
  if (state.replayInsertion) {
    // Replay insertion: play the clip once, then the caller restores the live feed.
    inputArgs = ['-re', '-i', state.replayInsertion.path];
  } else {
    inputArgs = inputManager.args();
  }

  return buildPipelineArgs({
    inputArgs,
    output: state.output,
    graphics: {
      enabled: graphicsReady,
      fifoPath: config.graphicsFifo,
      // The overlay canvas must be exactly the size the renderer produces.
      width: state.graphics.overlayWidth || dims.width,
      height: state.graphics.overlayHeight || dims.height,
      fps: state.graphics.overlayFps,
      scoreTextFile: overlay.textPath,
    },
    audio: {
      fifoPath: config.audioFifo,
      mix: mixer.getMix(),
      sampleRate: 48000,
      channels: 2,
    },
    target,
    preview: config.PREVIEW_ENABLED
      ? {
          enabled: true,
          dir: config.PREVIEW_DIR,
          bitrateKbps: 900,
          width: 854,
          height: 480,
        }
      : undefined,
    replay: state.replay.enabled
      ? {
          enabled: true,
          dir: config.REPLAY_DIR,
          segmentSeconds: 5,
          wrap: 24,
          bitrateKbps: 1500,
        }
      : undefined,
    encoding: {
      videoEncoder: encoding.videoEncoder,
      hwAccel: encoding.hwAccel,
      preset: state.output.preset === 'veryfast' && encoding.hwAccel !== 'off' ? encoding.preset : state.output.preset,
      threads: 0,
    },
    extraOutputFlags: state.output.extraOutputFlags,
  });
}

const pipeline = new Pipeline(buildArgs);

/* ------------------------------------------------------------------ */
/* Pipeline events                                                     */
/* ------------------------------------------------------------------ */

pipeline.on('start', ({ generation }) => {
  state.outputState = 'CONNECTING';
  state.startedAt = state.startedAt ?? Date.now();
  if (generation > 1) {
    state.outputReconnects += 1;
    inputManager.noteReconnect(`pipeline generation ${generation}`);
  }
  logger.info('ffmpeg', `Pipeline generation ${generation} launched -> ${maskTarget()}`);
});

pipeline.on('stats', (stats) => {
  state.stats = stats;
  inputManager.updateTelemetry({
    bitrateKbps: stats.bitrateKbps,
    fps: Math.round(stats.fps),
    droppedFrames: stats.droppedFrames,
    speed: stats.speed,
  });
  if (state.outputState !== 'CONNECTED' && stats.frame > 5) {
    state.outputState = 'CONNECTED';
    inputManager.setState('CONNECTED');
    state.lastError = null;
    logger.info('youtube', `Live output connected (${maskTarget()})`);
  }
});

pipeline.on('exit', ({ code }) => {
  state.outputState = 'RECONNECTING';
  if (code !== 0 && code !== null && code !== 255) {
    state.lastError = `ffmpeg exited with code ${code}`;
  }
});

/* ------------------------------------------------------------------ */
/* Status reporting                                                    */
/* ------------------------------------------------------------------ */

function currentStatus(): StreamStatus {
  const stats = state.stats;
  return {
    running: pipeline.isRunning,
    state: pipeline.isRunning ? state.outputState : state.startedAt ? 'DISCONNECTED' : 'IDLE',
    pipelineGeneration: pipeline.currentGeneration,
    uptimeSeconds: pipeline.uptimeSeconds,
    input: inputManager.getStatus(),
    output: {
      target: 'youtube',
      state: state.outputState,
      bitrateKbps: stats?.bitrateKbps ?? state.output.videoBitrateKbps,
      fps: Math.round(stats?.fps ?? 0),
      reconnectCount: state.outputReconnects,
      lastError: state.lastError,
      startedAt: state.startedAt ? new Date(state.startedAt).toISOString() : null,
      bytesSent: stats?.totalBytes ?? 0,
      updatedAt: new Date().toISOString(),
    },
    fps: Math.round(stats?.fps ?? 0),
    bitrateKbps: stats?.bitrateKbps ?? 0,
    speed: stats?.speed ?? 0,
    droppedFrames: stats?.droppedFrames ?? 0,
    cpuPercent: 0,
    lastError: state.lastError,
    updatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Command handling                                                    */
/* ------------------------------------------------------------------ */

/** Settings that cannot be changed inside a running filter graph. */
function requiresRestart(patch: Partial<AudioMixSettings>): boolean {
  return patch.originalVolume !== undefined || patch.duckingEnabled !== undefined || patch.duckAmount !== undefined;
}

async function handleCommand(cmd: WorkerCommand): Promise<void> {
  switch (cmd.type) {
    case 'stream:start': {
      const { ok, reason } = resolveOutputTarget();
      if (!ok) {
        state.lastError = reason ?? 'output not configured';
        logger.error('youtube', `Cannot start: ${reason}`);
        return;
      }
      try {
        inputManager.validate();
      } catch (err) {
        state.lastError = (err as Error).message;
        logger.error('ffmpeg', `Cannot start: ${(err as Error).message}`);
        return;
      }
      state.startedAt = Date.now();
      state.lastError = null;
      encoding = await detectEncoder();
      pipeline.start();
      break;
    }
    case 'stream:stop':
      await pipeline.stop('operator stop');
      state.startedAt = null;
      state.outputState = 'IDLE';
      state.stats = null;
      break;
    case 'stream:restart':
    case 'output:reconnect':
      await pipeline.restart(cmd.type === 'stream:restart' ? (cmd.payload?.reason ?? 'manual') : 'operator reconnect');
      break;
    case 'input:set': {
      const next = cmd.payload;
      inputManager.setSettings({
        kind: next.kind as never,
        url: next.url,
        rightsAttested: Boolean(next.rightsAttested),
        rightsNote: next.rightsNote ?? null,
      });
      logger.info('ffmpeg', `Input source updated: ${inputManager.describe()}`, { rightsAttested: next.rightsAttested });
      if (pipeline.isRunning) await pipeline.restart('input changed');
      break;
    }
    case 'audio:mix': {
      const patch = cmd.payload;
      mixer.setMix(patch);
      if (requiresRestart(patch) && pipeline.isRunning) {
        logger.info('ffmpeg', 'Audio graph change requires a rebuild - restarting pipeline');
        await pipeline.restart('audio mix changed');
      }
      break;
    }
    case 'tts:settings':
      tts.updateSettings(cmd.payload as Partial<TtsSettings>);
      break;
    case 'tts:speak':
      await engine.speakManual(cmd.payload.text, cmd.payload.language as never);
      break;
    case 'tts:clear':
      tts.clearQueue();
      break;
    case 'commentary:trigger':
      await engine.handleEvent(cmd.payload.event as MatchEvent);
      break;
    case 'replay:settings':
      state.replay = { ...state.replay, ...cmd.payload };
      replay?.updateSettings(cmd.payload);
      if (state.replay.enabled && pipeline.isRunning) await pipeline.restart('replay ring enabled');
      break;
    case 'graphics:settings':
      state.graphics = { ...state.graphics, ...cmd.payload };
      break;
    case 'replay:capture':
      replay?.onEvent(cmd.payload.event as MatchEvent);
      break;
    case 'ping':
      logger.debug('system', 'ping');
      break;
    default:
      logger.warn('system', `Unknown command: ${(cmd as { type: string }).type}`);
  }
}

/* ------------------------------------------------------------------ */
/* Replay insertion                                                    */
/* ------------------------------------------------------------------ */

async function insertReplayCut(clip: ReplayClipResult): Promise<void> {
  if (!pipeline.isRunning) return;
  // Safety: never cut away if the pipeline is already struggling.
  const speed = state.stats?.speed ?? 1;
  if (speed < 0.95) {
    logger.warn('system', `Skipping replay insertion - pipeline speed ${speed} below safe threshold`);
    return;
  }
  const durationMs = (clip.durationSeconds + 0.5) * 1000;
  logger.info('system', `Cutting to replay for ${(durationMs / 1000).toFixed(1)}s`);
  state.replayInsertion = { path: clip.filePath, endsAt: Date.now() + durationMs };
  await pipeline.restart('replay insertion');

  setTimeout(() => {
    state.replayInsertion = null;
    void pipeline.restart('replay finished - back to live');
  }, durationMs).unref?.();
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function loadBootstrap(retries = 5): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const boot = await backend.bootstrap();
    if (boot) {
      if (boot.ai) engine.updateSettings(boot.ai as never);
      if (boot.tts) tts.updateSettings(boot.tts as never);
      if (boot.audio) mixer.setMix(boot.audio as never);
      if (boot.graphics) state.graphics = { ...state.graphics, ...(boot.graphics as object) };
      if (boot.output) state.output = { ...state.output, ...(boot.output as object), rtmpUrl: config.YOUTUBE_RTMP_URL };
      if (boot.input) {
        inputManager.setSettings({
          kind: (boot.input as { kind: never }).kind,
          url: (boot.input as { url: string }).url,
          rightsAttested: (boot.input as { rightsAttested: boolean }).rightsAttested,
          rightsNote: (boot.input as { rightsNote?: string | null }).rightsNote ?? null,
        });
      }
      if (boot.replay) {
        state.replay = { ...state.replay, ...(boot.replay as object) };
        replay?.updateSettings(boot.replay as never);
      }
      if (boot.snapshot) {
        state.snapshot = boot.snapshot as ScoreSnapshot;
        overlay.writeTextFile(state.snapshot);
      }
      logger.info('system', 'Configuration loaded from backend');
      if (boot.stream?.shouldRun) {
        logger.info('system', 'Open stream session found - auto-resuming broadcast');
        void handleCommand({ type: 'stream:start' } as WorkerCommand);
      }
      return;
    }
    logger.warn('system', `Backend unavailable (attempt ${attempt}/${retries}) - retrying`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  logger.warn('system', 'Starting with built-in defaults (backend unreachable)');
}

async function main(): Promise<void> {
  logger.info('system', 'MatchCast stream-worker starting', {
    ffmpeg: resolveFfmpeg().split('/').pop(),
    backend: config.BACKEND_URL,
    target: maskTarget(),
  });

  installProcessGuards((err, kind) => {
    logger.error('system', `${kind}: ${err.message} - broadcast continues`);
  });
  setRemoteLogSink((entry) => backend.log(entry));

  encoding = await detectEncoder();
  replay = new ReplayBuffer(backend, config.REPLAY_DIR, (clip) => void insertReplayCut(clip), () => {
    const speed = state.stats?.speed ?? 1;
    return pipeline.isRunning && speed >= 0.95;
  });

  mixer.start();

  // Ensure the FIFO exists so the graphics worker can attach to it.
  if (!fs.existsSync(config.graphicsFifo)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { execSync } = require('node:child_process') as typeof import('node:child_process');
      execSync(`mkfifo "${config.graphicsFifo}"`, { stdio: 'ignore' });
    } catch (err) {
      logger.warn('system', 'Could not create graphics fifo', { error: (err as Error).message });
    }
  }

  await loadBootstrap();

  // ------------------------------------------------------------ realtime
  const socket = new WorkerSocket('stream-worker', () => ({
    pipelineRunning: pipeline.isRunning,
    generation: pipeline.currentGeneration,
    ttsQueue: tts.queueLength,
    speaking: mixer.speaking,
    input: inputManager.getStatus(),
    encoder: encoding.videoEncoder,
  }));
  socket.start();
  socket.onCommand(handleCommand);
  socket.on(EV.SCORE_UPDATE, (payload: ScoreSnapshot) => {
    state.snapshot = payload;
    overlay.writeTextFile(payload);
  });
  socket.on(EV.MATCH_EVENT, (event: MatchEvent) => {
    logger.debug('ai', `Match event: ${event.type} - ${event.headline}`);
    replay?.onEvent(event);
    void engine.handleEvent(event);
  });
  socket.on(EV.GRAPHICS_UPDATE, (settings: GraphicsSettings) => {
    state.graphics = { ...state.graphics, ...settings };
  });

  // ------------------------------------------------------------- timers
  setInterval(() => backend.reportStreamStatus(currentStatus()), 2000).unref();
  setInterval(() => void engine.maybeIdleSummary(), 15_000).unref();
  setInterval(() => {
    if (state.snapshot) overlay.writeTextFile(state.snapshot);
  }, 5000).unref();

  // -------------------------------------------------- graceful shutdown
  const shutdown = async () => {
    logger.info('system', 'Shutting down stream-worker');
    await pipeline.stop('process exit');
    await mixer.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  logger.info('system', 'stream-worker ready', {
    input: inputManager.describe(),
    resolution: state.output.resolution,
    fps: state.output.fps,
    encoder: encoding.videoEncoder,
  });
}

void main().catch((err) => {
  logger.fatal('system', `Fatal error: ${(err as Error).message}`);
  process.exit(1);
});
