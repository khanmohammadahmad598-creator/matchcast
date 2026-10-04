import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { FFMPEG_AVAILABLE, FFMPEG_SKIP_REASON } from '../../__tests__/helpers/media';

/**
 * A half-working ffmpeg is worse than none: it fails deep inside a live
 * broadcast (segmented concat, audio mixing) instead of at start-up. These
 * specs pin the resolution order and the "must be able to run" check.
 *
 * Anything that shells out to the binary is skipped where ffmpeg is absent -
 * see `__tests__/helpers/media.ts`.
 */

const ORIGINAL = process.env.FFMPEG_PATH;

const skipBecauseNoFfmpeg = FFMPEG_AVAILABLE ? '' : ` (${FFMPEG_SKIP_REASON})`;

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

  it.skipIf(!FFMPEG_AVAILABLE)(
    `prefers the system ffmpeg over the bundled static binary${skipBecauseNoFfmpeg}`,
    async () => {
      const { resolveFfmpeg } = await import('../config');
      const resolved = resolveFfmpeg();
      expect(resolved).not.toContain('ffmpeg-static');
      expect(execFileSync(resolved, ['-version'], { encoding: 'utf8' })).toContain('ffmpeg version');
    },
  );

  it('caches the resolved binary and survives a cache reset', async () => {
    const { resolveFfmpeg, resetFfmpegCache } = await import('../config');
    const first = resolveFfmpeg();
    expect(resolveFfmpeg()).toBe(first); // cached: no repeated probing

    resetFfmpegCache();
    expect(resolveFfmpeg()).toBe(first);
  });

  it.skipIf(!FFMPEG_AVAILABLE)(
    `never returns a binary that cannot run${skipBecauseNoFfmpeg}`,
    async () => {
      const { resolveFfmpeg, resetFfmpegCache } = await import('../config');
      resetFfmpegCache();
      const resolved = resolveFfmpeg();
      expect(execFileSync(resolved, ['-hide_banner', '-version'], { encoding: 'utf8' })).toContain(
        'ffmpeg version',
      );
    },
  );
});
