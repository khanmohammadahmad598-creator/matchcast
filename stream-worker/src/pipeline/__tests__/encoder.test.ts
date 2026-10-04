import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';

import { resolveFfmpeg } from '../../core/config';
import { detectEncoder } from '../encoder';

/**
 * Encoder selection must be *safe*, not just optimistic: an encoder that is
 * compiled into ffmpeg but cannot initialise on this host (h264_nvenc without
 * libcuda, h264_vaapi without /dev/dri) would kill the pipeline a few seconds
 * into a live broadcast. These specs pin that behaviour.
 */

const ORIGINAL = process.env.HW_ACCEL;

function canEncode(encoder: string): boolean {
  try {
    execFileSync(
      resolveFfmpeg(),
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=256x144:rate=25',
        '-frames:v', '1',
        '-c:v', encoder,
        '-f', 'null', '-',
      ],
      { stdio: 'ignore', timeout: 20_000 },
    );
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.HW_ACCEL;
  else process.env.HW_ACCEL = ORIGINAL;
});

describe('encoder detection', () => {
  it('uses the CPU encoder when HW_ACCEL=off', async () => {
    process.env.HW_ACCEL = 'off';
    const { detectEncoder: detect } = await import('../encoder');
    await expect(detect()).resolves.toEqual({
      videoEncoder: 'libx264',
      hwAccel: 'off',
      preset: 'veryfast',
    });
  });

  it('never selects an encoder that cannot encode a frame on this host', async () => {
    process.env.HW_ACCEL = 'auto';
    const { detectEncoder: detect } = await import('../encoder');
    const choice = await detect();

    expect(['libx264', 'h264_nvenc', 'h264_vaapi', 'h264_qsv']).toContain(choice.videoEncoder);
    // The invariant that matters: whatever it picked, it actually works here.
    expect(canEncode(choice.videoEncoder)).toBe(true);
  });

  it('degrades to CPU instead of choosing a forced but broken hardware encoder', async () => {
    process.env.HW_ACCEL = 'nvidia';
    const { detectEncoder: detect } = await import('../encoder');
    const choice = await detect();

    if (canEncode('h264_nvenc')) expect(choice.videoEncoder).toBe('h264_nvenc');
    else expect(choice.videoEncoder).toBe('libx264'); // no NVIDIA driver here
  });

  it('caches the choice for the life of the process', async () => {
    process.env.HW_ACCEL = 'auto';
    const { detectEncoder: detect } = await import('../encoder');
    const first = await detect();
    const second = await detect();
    expect(second).toBe(first);
  });
});
