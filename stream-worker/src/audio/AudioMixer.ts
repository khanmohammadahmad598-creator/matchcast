import fs from 'node:fs';
import { spawn, ChildProcess } from 'node:child_process';
import { logger } from '../core/logger';
import { resolveFfmpeg } from '../core/config';
import { AUDIO_CHANNELS, AUDIO_SAMPLE_RATE, clamp } from '@matchcast/shared';
import type { AudioMixSettings } from '@matchcast/shared';

const TICK_MS = 20;
const BYTES_PER_TICK = ((AUDIO_SAMPLE_RATE * TICK_MS) / 1000) * AUDIO_CHANNELS * 2; // 3840 @48k stereo s16
const MAX_BUFFERED_BYTES = AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * 2 * 3; // 3 seconds

/**
 * Software mixer for everything we generate ourselves (AI commentary + the
 * optional licensed background bed). The original match audio stays inside
 * FFmpeg and is ducked there with `sidechaincompress`, driven by this output.
 *
 * Output is raw s16le PCM written to the named pipe FFmpeg reads.
 */
export class AudioMixer {
  private stream: fs.WriteStream | null = null;
  private timer: NodeJS.Timeout | null = null;
  private queue: Buffer[] = [];
  private writing = false;

  /** Commentary clips play strictly one after another - never overlapping. */
  private pending: Array<{ id: string; pcm: Buffer; pos: number; gain: number; resolve: () => void }> = [];
  private active: { id: string; pcm: Buffer; pos: number; gain: number; resolve: () => void } | null = null;

  private background: { proc: ChildProcess; ring: Buffer; volume: number } | null = null;
  private backgroundPath: string | null = null;

  private mix: AudioMixSettings = {
    originalVolume: 1,
    commentaryVolume: 1,
    backgroundVolume: 0.25,
    masterMute: false,
    duckingEnabled: true,
    duckAmount: 0.6,
    backgroundTrackPath: null,
  };

  constructor(private fifoPath: string) {}

  get speaking(): boolean {
    return this.active !== null;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  setMix(patch: Partial<AudioMixSettings>): void {
    const before = this.mix;
    this.mix = { ...this.mix, ...patch };
    if (patch.backgroundTrackPath !== undefined && patch.backgroundTrackPath !== before.backgroundTrackPath) {
      this.setBackground(patch.backgroundTrackPath);
    }
    if (patch.backgroundVolume !== undefined && this.background) {
      this.background.volume = patch.backgroundVolume;
    }
  }

  getMix(): AudioMixSettings {
    return this.mix;
  }

  /** Opens (and re-opens) the FIFO. Safe to call repeatedly. */
  private ensureStream(): void {
    if (this.stream && !this.stream.destroyed) return;
    try {
      if (!fs.existsSync(this.fifoPath)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { execSync } = require('node:child_process') as typeof import('node:child_process');
        execSync(`mkfifo "${this.fifoPath}"`, { stdio: 'ignore' });
      }
    } catch (err) {
      logger.debug('tts', 'Could not create audio fifo', { error: (err as Error).message });
    }

    const stream = fs.createWriteStream(this.fifoPath, { flags: 'w' });
    stream.on('error', (err) => {
      // EPIPE happens when FFmpeg restarts; reopen on the next tick.
      logger.debug('tts', 'Audio fifo write error - will reopen', { error: err.message });
      this.stream = null;
      try {
        stream.destroy();
      } catch {
        /* ignore */
      }
    });
    this.stream = stream;
  }

  start(): void {
    if (this.timer) return;
    this.ensureStream();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
    logger.info('tts', `Audio mixer started (${this.fifoPath})`, { bytesPerTick: BYTES_PER_TICK });
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.setBackground(null);
    this.active?.resolve();
    this.active = null;
    for (const p of this.pending) p.resolve();
    this.pending = [];
    await new Promise<void>((resolve) => {
      if (!this.stream || this.stream.destroyed) return resolve();
      this.stream.end(() => resolve());
      setTimeout(resolve, 500);
    });
    this.stream = null;
  }

  /** Enqueue a commentary clip; resolves when it has finished playing. */
  async playCommentary(pcm: Buffer, opts: { gain?: number; id?: string } = {}): Promise<void> {
    return new Promise((resolve) => {
      const entry = {
        id: opts.id ?? `clip-${Date.now()}`,
        pcm,
        pos: 0,
        gain: opts.gain ?? this.mix.commentaryVolume,
        resolve,
      };
      this.pending.push(entry);
      // Hard cap: drop the oldest queued line so commentary never runs minutes late.
      if (this.pending.length > 8) {
        const dropped = this.pending.shift();
        dropped?.resolve();
        logger.warn('tts', 'Commentary queue overflow - dropped oldest clip');
      }
    });
  }

  clearQueue(): void {
    for (const p of this.pending) p.resolve();
    this.pending = [];
  }

  /** Continuous licensed background bed (optional). */
  setBackground(path: string | null): void {
    this.backgroundPath = path;
    if (this.background) {
      try {
        this.background.proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      this.background = null;
    }
    if (!path || !fs.existsSync(path)) return;

    const proc = spawn(resolveFfmpeg(), [
      '-hide_banner', '-loglevel', 'error',
      '-stream_loop', '-1', '-re', '-i', path,
      '-f', 's16le', '-ar', String(AUDIO_SAMPLE_RATE), '-ac', String(AUDIO_CHANNELS), '-',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    const entry = { proc, ring: Buffer.alloc(0), volume: this.mix.backgroundVolume };
    proc.stdout?.on('data', (chunk: Buffer) => {
      entry.ring = Buffer.concat([entry.ring, chunk]);
      if (entry.ring.length > MAX_BUFFERED_BYTES) {
        entry.ring = entry.ring.subarray(entry.ring.length - MAX_BUFFERED_BYTES);
      }
    });
    proc.on('exit', () => {
      if (this.background === entry) this.background = null;
    });
    this.background = entry;
    logger.info('tts', 'Background bed loaded', { path: path.split('/').pop() });
  }

  private tick(): void {
    // ---- advance the active clip -------------------------------------------
    if (!this.active && this.pending.length) {
      this.active = this.pending.shift() ?? null;
    }

    const out = Buffer.alloc(BYTES_PER_TICK);

    if (this.active) {
      const { pcm, pos, gain } = this.active;
      const remaining = pcm.length - pos;
      const take = Math.min(BYTES_PER_TICK, remaining);
      if (take > 0) {
        applyGain(pcm.subarray(pos, pos + take), out, gain);
        this.active.pos += take;
      }
      if (this.active.pos >= pcm.length) {
        const finished = this.active;
        this.active = null;
        finished.resolve();
      }
    }

    // ---- background bed ------------------------------------------------------
    if (this.background && this.mix.backgroundVolume > 0) {
      const ring = this.background.ring;
      if (ring.length >= BYTES_PER_TICK) {
        applyGain(ring.subarray(0, BYTES_PER_TICK), out, this.background.volume, true);
        this.background.ring = ring.subarray(BYTES_PER_TICK);
      }
    }

    if (this.mix.masterMute) out.fill(0);
    this.write(out);
  }

  private write(chunk: Buffer): void {
    this.ensureStream();
    const stream = this.stream;
    if (!stream || stream.destroyed) return;
    // Backpressure guard: drop rather than fall behind live.
    if ((stream.writableLength ?? 0) > MAX_BUFFERED_BYTES) return;
    this.queue.push(chunk);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.queue.length) {
        const chunk = this.queue.shift()!;
        const stream = this.stream;
        if (!stream || stream.destroyed) return;
        const ok = stream.write(chunk);
        if (!ok) {
          await new Promise<void>((resolve) => {
            let settled = false;
            const done = () => {
              if (settled) return;
              settled = true;
              stream.off('drain', done);
              resolve();
            };
            stream.on('drain', done);
            setTimeout(done, 250);
          });
        }
      }
    } catch (err) {
      logger.debug('tts', 'Audio write failed', { error: (err as Error).message });
    } finally {
      this.writing = false;
    }
  }
}

/** `dst += src * gain` (or `dst = src * gain` when accumulate=false), clipped to int16. */
function applyGain(src: Buffer, dst: Buffer, gain: number, accumulate = false): void {
  const len = Math.min(src.length, dst.length);
  for (let i = 0; i < len - 1; i += 2) {
    const sample = src.readInt16LE(i) * gain;
    const existing = accumulate ? dst.readInt16LE(i) : 0;
    const value = clamp(Math.round(existing + sample), -32768, 32767);
    dst.writeInt16LE(value, i);
  }
}

export { BYTES_PER_TICK, TICK_MS };
