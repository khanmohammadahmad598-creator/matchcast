import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';

/**
 * A half-working ffmpeg is worse than none: it fails deep inside a live
 * broadcast (segmented concat, audio mixing) instead of at start-up. These
 * specs pin the resolution order and the "must be able to run" check.
 */

const ORIGINAL = process.env.FFMPEG_PATH;

const systemFfmpegWorks = (): boolean => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const hasSystemFfmpeg = systemFfmpegWorks();

beforeEach(() => {
  vi.resetModules();
  delete process.env.FFMPEG_PATH;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.FFMPEG_PATH;
  else process.env.FFMPEG_PATH = ORIGINAL;
});

describe('resolveFfmpeg', () => {
  it('honours an explicit FFMPEG_PATH (operator override wins)', async () => {
    process.env.FFMPEG_PATH = '/opt/matchcast/bin/ffmpeg';
    const { resolveFfmpeg } = await import('../config');
    expect(resolveFfmpeg()).toBe('/opt/matchcast/bin/ffmpeg');
  });

  it('prefers the system ffmpeg over the bundled static binary', async () => {
    if (!hasSystemFfmpeg) return; // nothing to assert on a host without ffmpeg
    const { resolveFfmpeg } = await import('../config');
    const resolved = resolveFfmpeg();
    expect(resolved).not.toContain('ffmpeg-static');
    expect(execFileSync(resolved, ['-version'], { encoding: 'utf8' })).toContain('ffmpeg version');
  });

  it('caches the resolved binary and survives a cache reset', async () => {
    const { resolveFfmpeg, resetFfmpegCache } = await import('../config');
    const first = resolveFfmpeg();
    expect(resolveFfmpeg()).toBe(first); // cached: no repeated probing

    resetFfmpegCache();
    const again = resolveFfmpeg();
    expect(again).toBe(first);
    if (hasSystemFfmpeg || !first.includes('ffmpeg-static')) {
      expect(execFileSync(again, ['-version'], { encoding: 'utf8' })).toContain('ffmpeg version');
    }
  });
});
