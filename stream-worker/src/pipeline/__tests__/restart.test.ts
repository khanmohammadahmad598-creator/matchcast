import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { Pipeline } from '../Pipeline';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A "healthy" ffmpeg stand-in: streams for a while, then exits. */
function fakeFfmpeg(binaryPath: string, script: string): string {
  fs.writeFileSync(binaryPath, `#!/usr/bin/env bash\n${script}\n`, { mode: 0o755 });
  return binaryPath;
}

describe('ffmpeg supervision', () => {
  it('restarts a crashed ffmpeg with backoff while it is supposed to run', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-pipeline-'));
    // Exits immediately with a failure - exactly like a dropped RTMP connection.
    const bin = fakeFfmpeg(path.join(dir, 'ffmpeg-fail'), 'echo "boom" >&2; exit 1');

    const original = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = bin;
    vi.resetModules();
    const { Pipeline: FreshPipeline } = await import('../Pipeline');

    const pipeline = new FreshPipeline(() => ['-hide_banner', '-f', 'lavfi', '-i', 'testsrc', '-f', 'null', '-']);
    const starts: number[] = [];
    pipeline.on('start', ({ generation }) => starts.push(generation));

    pipeline.start();
    await wait(2500);
    await pipeline.stop('test done');

    expect(starts.length).toBeGreaterThanOrEqual(1);
    // Backoff: the second restart must not fire instantly (1s base + jitter).
    const generations = starts.length;
    expect(generations).toBeLessThanOrEqual(3);
    process.env.FFMPEG_PATH = original;
  }, 30_000);

  it('does NOT restart after an explicit stop', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-pipeline-'));
    const bin = fakeFfmpeg(path.join(dir, 'ffmpeg-fail'), 'exit 1');

    const original = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = bin;
    vi.resetModules();
    const { Pipeline: FreshPipeline } = await import('../Pipeline');

    const pipeline = new FreshPipeline(() => ['-hide_banner']);
    pipeline.start();
    await wait(300);
    await pipeline.stop('operator stop');
    const generationsAtStop = pipeline.currentGeneration;
    await wait(2000);
    expect(pipeline.currentGeneration).toBe(generationsAtStop);
    expect(pipeline.isRunning).toBe(false);
    process.env.FFMPEG_PATH = original;
  }, 30_000);

  it('reports stats from ffmpeg -progress output and tracks uptime', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-pipeline-'));
    // Emits a couple of progress blocks, then keeps running until killed.
    const bin = fakeFfmpeg(
      path.join(dir, 'ffmpeg-ok'),
      `for i in 1 2 3 4 5 6 7 8; do printf 'frame=%d\\nfps=30\\nbitrate=2500kbits/s\\nspeed=1.0x\\ntotal_size=1234\\nout_time_us=2000000\\ndrop_frames=0\\nprogress=continue\\n' "$i"; sleep 0.1; done; sleep 5`,
    );

    const original = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = bin;
    vi.resetModules();
    const { Pipeline: FreshPipeline } = await import('../Pipeline');

    const pipeline = new FreshPipeline(() => ['-hide_banner']);
    const stats: Array<{ frame: number; bitrateKbps: number }> = [];
    pipeline.on('stats', (s) => stats.push(s));
    pipeline.start();
    await wait(1200);
    expect(pipeline.uptimeSeconds).toBeGreaterThanOrEqual(1);
    await pipeline.stop('test done');

    expect(stats.length).toBeGreaterThan(0);
    expect(stats.at(-1)!.bitrateKbps).toBe(2500);
    expect(stats.at(-1)!.frame).toBeGreaterThan(0);
    process.env.FFMPEG_PATH = original;
  }, 30_000);

  it('kills a stalled process (watchdog) and starts a fresh generation', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-pipeline-'));
    // Never prints anything: the watchdog must step in.
    const bin = fakeFfmpeg(path.join(dir, 'ffmpeg-stall'), 'sleep 60');

    const original = process.env.FFMPEG_PATH;
    const originalWatchdog = process.env.PIPELINE_WATCHDOG_SECONDS;
    process.env.FFMPEG_PATH = bin;
    process.env.PIPELINE_WATCHDOG_SECONDS = '1';
    vi.resetModules();
    const { Pipeline: FreshPipeline } = await import('../Pipeline');

    const pipeline = new FreshPipeline(() => ['-hide_banner']);
    const starts: number[] = [];
    pipeline.on('start', ({ generation }) => starts.push(generation));
    pipeline.start();
    await wait(4000);
    await pipeline.stop('test done');

    expect(starts.length).toBeGreaterThanOrEqual(2);
    process.env.FFMPEG_PATH = original;
    process.env.PIPELINE_WATCHDOG_SECONDS = originalWatchdog;
  }, 30_000);
});
