import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config, resolveFfmpeg } from '../core/config';
import { logger } from '../core/logger';
import type { BackendClient } from '../core/backendClient';
import type { MatchEvent, ReplaySettings } from '@matchcast/shared';

const DEFAULT_SETTINGS: ReplaySettings = {
  enabled: false,
  preRollSeconds: 8,
  postRollSeconds: 4,
  mode: 'off',
  playbackRate: 0.6,
  maxLatencySeconds: 6,
  triggerEvents: ['SIX', 'WICKET', 'MILESTONE'],
};

export interface ReplayClipResult {
  filePath: string;
  durationSeconds: number;
  eventType: string;
  eventId: string;
}

/**
 * Rolling replay buffer.
 *
 * The pipeline continuously writes short MPEG-TS segments to a ring directory
 * (see the `segment` output in ffmpegArgs). On a major event we wait for the
 * post-roll, then concatenate the relevant segments into a single clip with an
 * optional slow-motion factor.
 *
 * Insertion is deliberately conservative:
 *  - mode 'off'  : clips are only archived (zero added latency)
 *  - mode 'cut'  : the pipeline briefly switches to the clip, then back to live
 *  - mode 'overlay' : reserved (see docs/REPLAYS.md)
 */
export class ReplayBuffer {
  private settings: ReplaySettings = { ...DEFAULT_SETTINGS };
  private pending = new Set<string>();
  private segmentSeconds = 5;

  constructor(
    private backend: BackendClient,
    private dir: string = config.REPLAY_DIR,
    private onClipReady?: (clip: ReplayClipResult) => void,
    private isHealthy: () => boolean = () => true,
  ) {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  updateSettings(patch: Partial<ReplaySettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  getSettings(): ReplaySettings {
    return this.settings;
  }

  setSegmentSeconds(seconds: number): void {
    this.segmentSeconds = seconds;
  }

  /** Called for every scoring event; returns true if a capture was scheduled. */
  onEvent(event: MatchEvent): boolean {
    if (!this.settings.enabled) return false;
    if (!this.settings.triggerEvents.includes(event.type)) return false;
    if (this.pending.has(event.id)) return false;
    this.pending.add(event.id);

    const waitMs = this.settings.postRollSeconds * 1000;
    logger.info('system', `Replay capture scheduled for ${event.type} (in ${this.settings.postRollSeconds}s)`);
    setTimeout(() => {
      void this.capture(event);
    }, waitMs).unref?.();
    return true;
  }

  private async capture(event: MatchEvent): Promise<void> {
    try {
      const segments = this.latestSegments(this.settings.preRollSeconds + this.settings.postRollSeconds);
      if (!segments.length) {
        logger.warn('system', 'No replay segments available yet');
        return;
      }
      const outFile = path.join(this.dir, `replay-${event.type.toLowerCase()}-${Date.now()}.mp4`);
      const duration = await this.concat(segments, outFile, this.settings.playbackRate);
      const clip: ReplayClipResult = {
        filePath: outFile,
        durationSeconds: duration,
        eventType: event.type,
        eventId: event.id,
      };
      logger.info('system', `Replay clip ready: ${path.basename(outFile)} (${duration.toFixed(1)}s)`);

      // Report whether this clip will actually go to air, so the dashboard and
      // the audit trail can tell "archived" from "broadcast".
      const inserted = this.settings.mode === 'cut' && this.isHealthy();

      void this.backend.createReplayClip({
        matchId: event.matchId,
        eventType: event.type,
        filePath: outFile,
        durationSeconds: duration,
        inserted,
      });

      if (inserted) {
        this.onClipReady?.(clip);
      }
    } catch (err) {
      logger.error('system', 'Replay capture failed', { error: (err as Error).message });
    } finally {
      this.pending.delete(event.id);
    }
  }

  /** Most recent segments covering roughly `windowSeconds`, oldest first. */
  private latestSegments(windowSeconds: number): string[] {
    const files = fs
      .readdirSync(this.dir)
      .filter((f) => /^seg_\d+\.ts$/.test(f))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(this.dir, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime);
    const count = Math.max(1, Math.ceil(windowSeconds / this.segmentSeconds));
    return files.slice(-count).map((f) => path.join(this.dir, f.name));
  }

  /** Concatenates segments, applying slow motion, and returns the clip duration. */
  private async concat(segments: string[], outFile: string, rate: number): Promise<number> {
    const listFile = path.join(this.dir, `list-${Date.now()}.txt`);
    fs.writeFileSync(listFile, segments.map((s) => `file '${s}'`).join('\n'));

    const audioChain = atempoChain(rate);
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', listFile,
      '-vf', `setpts=PTS/${rate}`,
      ...(audioChain ? ['-af', audioChain] : []),
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k',
      '-movflags', '+faststart',
      outFile,
    ];

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(resolveFfmpeg(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr?.on('data', (c: Buffer) => {
        stderr += c.toString();
      });
      proc.on('error', reject);
      proc.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`replay concat failed (${code}): ${stderr.slice(0, 200)}`)),
      );
    });

    fs.rmSync(listFile, { force: true });
    return probeDuration(outFile);
  }
}

/** atempo only accepts 0.5..2.0, so chain factors for slower playback. */
export function atempoChain(rate: number): string | null {
  if (!rate || rate === 1) return null;
  const factors: number[] = [];
  if (rate > 1) {
    let remaining = rate;
    while (remaining > 1.001) {
      const f = Math.min(2, remaining);
      factors.push(f);
      remaining /= f;
    }
  } else {
    let remaining = rate;
    while (remaining < 0.999) {
      const f = Math.max(0.5, remaining);
      factors.push(f);
      remaining /= f;
    }
  }
  return factors.length ? factors.map((f) => `atempo=${f.toFixed(3)}`).join(',') : null;
}

export function probeDuration(file: string): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const out = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
    ], { encoding: 'utf8' });
    return Number.parseFloat(out.trim()) || 0;
  } catch {
    return 0;
  }
}
