import { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { config, resolveFfmpeg } from '../core/config';
import { logger } from '../core/logger';
import { maskTarget, redactStreamKey } from '../core/config';

export interface PipelineStats {
  frame: number;
  fps: number;
  bitrateKbps: number;
  speed: number;
  droppedFrames: number;
  totalBytes: number;
  outTimeSeconds: number;
}

export interface PipelineEvents {
  stats: (stats: PipelineStats) => void;
  exit: (info: { code: number | null; signal: string | null; generation: number }) => void;
  error: (err: Error) => void;
  start: (info: { generation: number; args: string[] }) => void;
}

/**
 * Spawns and supervises the FFmpeg process.
 *
 * Guarantees:
 *  - the pipeline is restarted with exponential backoff if FFmpeg dies while it
 *    is supposed to be running (crash, network drop, encoder failure)
 *  - a watchdog restarts a "living but stalled" process (no progress output)
 *  - stopping is graceful (SIGINT, then SIGKILL)
 */
export class Pipeline extends EventEmitter {
  private proc: ChildProcess | null = null;
  private generation = 0;
  private desired = false;
  private restartAttempt = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private lastProgressAt = 0;
  private startedAt = 0;
  /** Once a generation survives HEALTHY_AFTER_MS the restart backoff resets. */
  private static readonly HEALTHY_AFTER_MS = 30_000;
  private stdoutBuffer = '';
  private stderrTail: string[] = [];

  constructor(private buildArgs: () => string[]) {
    super();
    this.setMaxListeners(50);
  }

  get isRunning(): boolean {
    return this.proc !== null;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  get uptimeSeconds(): number {
    return this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0;
  }

  /** Begin (re)starting the pipeline. Idempotent. */
  start(): void {
    if (this.desired && this.proc) return;
    this.desired = true;
    this.spawn();
  }

  async stop(reason = 'stopped'): Promise<void> {
    this.desired = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.clearWatchdog();
    this.restartAttempt = 0;
    await this.kill(reason);
  }

  /** Force a restart (used on settings changes that require a graph rebuild). */
  async restart(reason: string): Promise<void> {
    if (!this.desired) return;
    logger.info('ffmpeg', `Restarting pipeline: ${reason}`);
    await this.kill(`restart: ${reason}`);
    this.spawn();
  }

  private spawn(): void {
    if (!this.desired) return;
    if (this.proc) return;

    const args = this.buildArgs();
    this.generation += 1;
    const gen = this.generation;
    const ffmpeg = resolveFfmpeg();

    logger.info('ffmpeg', `Starting pipeline generation ${gen}`, {
      ffmpeg: ffmpeg.split('/').pop(),
      target: maskTarget(),
    });
    // Full argv at DEBUG level - makes pipeline problems reproducible by hand.
    logger.debug(
      'ffmpeg',
      `argv: ${redactStreamKey([ffmpeg, ...args].join(' '))}`,
    );
    this.emit('start', { generation: gen, args });

    const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    this.startedAt = Date.now();
    this.lastProgressAt = Date.now();
    this.stdoutBuffer = '';
    this.stderrTail = [];

    proc.stdout?.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString();
      const lines = this.stdoutBuffer.split('\n');
      this.stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) this.handleProgressLine(line);
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      this.stderrTail.push(...text.split('\n').filter(Boolean));
      if (this.stderrTail.length > 30) this.stderrTail.splice(0, this.stderrTail.length - 30);
      const clean = text.trim();
      if (clean) {
        // FFmpeg writes diagnostics to stderr; surface them but never secrets.
        logger.warn('ffmpeg', clean.slice(0, 400));
      }
    });

    proc.on('error', (err) => {
      logger.error('ffmpeg', `Failed to start FFmpeg: ${err.message}`);
      this.emit('error', err);
      this.handleExit(gen, null, null);
    });

    proc.on('exit', (code, signal) => {
      this.handleExit(gen, code, signal);
    });

    this.armWatchdog();
  }

  /**
   * FFmpeg's -progress output is a repeating block of `key=value` lines
   * terminated by `progress=continue|end`.
   */
  private currentBlock: Record<string, string> = {};

  private handleProgressLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.lastProgressAt = Date.now();

    const match = /^([a-z_]+)=(.*)$/.exec(trimmed);
    if (!match) return;
    const [, key, value] = match;

    if (key === 'progress') {
      this.flushStats();
      return;
    }
    this.currentBlock[key] = value.trim();
  }

  private flushStats(): void {
    if (this.startedAt && Date.now() - this.startedAt > Pipeline.HEALTHY_AFTER_MS && this.restartAttempt > 0) {
      this.restartAttempt = 0;
    }
    const b = this.currentBlock;
    if (!b.frame && !b.bitrate) return;

    // ffmpeg reports `bitrate` in kbits/s already.
    const bitrateKbps = Number.parseFloat((b.bitrate ?? '0').replace(/kbits\/s/i, '').trim()) || 0;

    const stats: PipelineStats = {
      frame: Number.parseInt(b.frame ?? '0', 10) || 0,
      fps: Number.parseFloat(b.fps ?? '0') || 0,
      bitrateKbps: Math.round(bitrateKbps),
      speed: Number.parseFloat((b.speed ?? '0').replace('x', '')) || 0,
      droppedFrames: Number.parseInt(b.drop_frames ?? '0', 10) || 0,
      totalBytes: Number.parseInt(b.total_size ?? '0', 10) || 0,
      outTimeSeconds: Math.round((Number.parseInt(b.out_time_us ?? '0', 10) || 0) / 1_000_000),
    };
    this.emit('stats', stats);
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    // Poll at least twice per stall window (and at most every second) so a
    // hung encoder is noticed quickly without a busy loop.
    const intervalMs = Math.max(1000, Math.min(5_000, (config.PIPELINE_WATCHDOG_SECONDS * 1000) / 2));
    this.watchdog = setInterval(() => {
      if (!this.proc) return;
      const idle = (Date.now() - this.lastProgressAt) / 1000;
      if (idle > config.PIPELINE_WATCHDOG_SECONDS) {
        logger.error('ffmpeg', `No FFmpeg progress for ${Math.round(idle)}s - restarting pipeline`);
        const proc = this.proc;
        this.proc = null; // take ownership so handleExit does not double-restart
        try {
          proc?.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        this.scheduleRestart('watchdog: no progress');
      }
    }, intervalMs);
    this.watchdog.unref();
  }

  private clearWatchdog(): void {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
  }

  private handleExit(gen: number, code: number | null, signal: string | null): void {
    if (gen !== this.generation) return; // stale process
    this.proc = null;
    this.clearWatchdog();
    const tail = this.stderrTail.slice(-3).join(' | ').slice(0, 400);
    logger.warn('ffmpeg', `FFmpeg exited (generation ${gen})`, { code, signal, tail });
    this.emit('exit', { code, signal, generation: gen });
    if (this.desired) this.scheduleRestart(`exit code=${code} signal=${signal}`);
  }

  private scheduleRestart(reason: string): void {
    if (!this.desired) return;
    this.restartAttempt += 1;
    const delayMs = Math.min(config.MAX_RESTART_BACKOFF_SECONDS * 1000, 1000 * 2 ** Math.min(6, this.restartAttempt - 1));
    const jitter = Math.round(delayMs * 0.2 * Math.random());
    logger.info('ffmpeg', `Scheduling restart in ${delayMs + jitter}ms (${reason})`, { attempt: this.restartAttempt });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawn();
    }, delayMs + jitter);
    this.restartTimer.unref?.();
  }

  private async kill(reason: string): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    logger.info('ffmpeg', `Stopping pipeline (${reason})`);
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        done();
      }, 5000);
      proc.once('exit', () => {
        clearTimeout(timer);
        done();
      });
      try {
        proc.kill('SIGINT');
      } catch {
        clearTimeout(timer);
        done();
      }
    });
  }
}

export declare interface Pipeline {
  on<K extends keyof PipelineEvents>(event: K, listener: PipelineEvents[K]): this;
  emit<K extends keyof PipelineEvents>(event: K, ...args: Parameters<PipelineEvents[K]>): boolean;
}
