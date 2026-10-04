import 'dotenv/config';
import { config } from './core/config';
import { logger, setRemoteLogSink } from './core/logger';
import { backend } from './core/backendClient';
import { WorkerSocket } from './core/workerSocket';
import { FrameWriter } from './core/FrameWriter';
import { CanvasRenderer } from './renderers/canvas';
import { installProcessGuards } from '@matchcast/shared';
import { EV } from '@matchcast/shared';
import type { FlashGraphic } from './renderers/types';
import type { GraphicsSettings, ScoreSnapshot, WorkerCommand } from '@matchcast/shared';

const DEFAULT_SETTINGS: GraphicsSettings = {
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
};

const state: {
  snapshot: ScoreSnapshot | null;
  settings: GraphicsSettings;
  flash: FlashGraphic | null;
  frames: number;
  written: number;
  lastFpsAt: number;
  fps: number;
} = {
  snapshot: null,
  settings: { ...DEFAULT_SETTINGS },
  flash: null,
  frames: 0,
  written: 0,
  lastFpsAt: Date.now(),
  fps: 0,
};

const dims = {
  width: state.settings.overlayWidth,
  height: state.settings.overlayHeight,
};
const renderer = new CanvasRenderer(dims.width, dims.height);
let frameBytes = dims.width * dims.height * 4;
const writer = new FrameWriter(config.fifoPath, frameBytes);

/* ------------------------------------------------------------------ */
/* Render loop                                                         */
/* ------------------------------------------------------------------ */

let timer: NodeJS.Timeout | null = null;

function scheduleLoop(): void {
  if (timer) clearInterval(timer);
  const fps = Math.max(5, Math.min(60, state.settings.overlayFps || 15));
  const interval = Math.round(1000 / fps);
  timer = setInterval(() => {
    const frame = renderer.render({
      snapshot: state.snapshot,
      settings: state.settings,
      flash: state.flash && state.flash.until > Date.now() ? state.flash : null,
    });
    state.frames += 1;
    if (writer.write(frame)) state.written += 1;

    // fps sampling
    const now = Date.now();
    if (now - state.lastFpsAt >= 1000) {
      state.fps = Math.round((state.frames * 1000) / (now - state.lastFpsAt));
      state.frames = 0;
      state.lastFpsAt = now;
    }
  }, interval);
  timer.unref?.();
  logger.info('system', `Render loop running at ${fps} fps (${state.settings.overlayWidth}x${state.settings.overlayHeight})`);
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

async function handleCommand(cmd: WorkerCommand): Promise<void> {
  switch (cmd.type) {
    case 'graphics:settings': {
      state.settings = { ...state.settings, ...cmd.payload };
      renderer.resize(state.settings.overlayWidth, state.settings.overlayHeight);
      if (state.settings.sponsorLogoUrl) renderer.preloadLogo(state.settings.sponsorLogoUrl);
      scheduleLoop();
      logger.info('system', 'Graphics settings applied', {
        template: state.settings.templateId,
        fps: state.settings.overlayFps,
      });
      break;
    }
    case 'graphics:flash': {
      const { title, subtitle, ms } = cmd.payload;
      state.flash = { title, subtitle: subtitle ?? null, until: Date.now() + Math.min(60_000, ms ?? 4000) };
      logger.info('system', `Flash graphic: ${title}`);
      break;
    }
    case 'ping':
      break;
    default:
      // Other commands target the stream worker.
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  logger.info('system', 'MatchCast graphics-worker starting', {
    backend: config.BACKEND_URL,
    fifo: config.fifoPath,
    size: `${state.settings.overlayWidth}x${state.settings.overlayHeight}`,
  });

  installProcessGuards((err, kind) => {
    logger.error('system', `${kind}: ${err.message} - overlay continues`);
  });
  setRemoteLogSink((entry) => backend.log(entry));

  const boot = await backend.bootstrap();
  if (boot?.graphics) state.settings = { ...state.settings, ...(boot.graphics as object) };
  renderer.resize(state.settings.overlayWidth, state.settings.overlayHeight);
  frameBytes = state.settings.overlayWidth * state.settings.overlayHeight * 4;
  if (boot?.snapshot) state.snapshot = boot.snapshot as ScoreSnapshot;
  if (state.settings.sponsorLogoUrl) renderer.preloadLogo(state.settings.sponsorLogoUrl);

  writer.ensureOpen();
  scheduleLoop();

  const socket = new WorkerSocket('graphics-worker', () => ({
    fps: state.fps,
    framesWritten: state.written,
    template: state.settings.templateId,
    attached: writer.isReady,
    size: `${state.settings.overlayWidth}x${state.settings.overlayHeight}`,
  }));
  socket.start();
  socket.onCommand(handleCommand);
  socket.on(EV.SCORE_UPDATE, (payload: ScoreSnapshot) => {
    state.snapshot = payload;
    if (payload.battingTeam?.logoUrl) renderer.preloadLogo(payload.battingTeam.logoUrl);
    if (payload.bowlingTeam?.logoUrl) renderer.preloadLogo(payload.bowlingTeam.logoUrl);
  });
  socket.on(EV.GRAPHICS_UPDATE, (payload: GraphicsSettings) => {
    state.settings = { ...state.settings, ...payload };
    renderer.resize(state.settings.overlayWidth, state.settings.overlayHeight);
    scheduleLoop();
  });

  const shutdown = async () => {
    logger.info('system', 'Shutting down graphics-worker');
    writer.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  logger.info('system', 'graphics-worker ready');
}

void main().catch((err) => {
  logger.fatal('system', `Fatal error: ${(err as Error).message}`);
  process.exit(1);
});
