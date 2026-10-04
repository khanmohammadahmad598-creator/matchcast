import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { config, resolveFfmpeg } from '../core/config';
import { logger } from '../core/logger';

const execFileAsync = promisify(execFile);

export type HwAccel = 'off' | 'nvidia' | 'vaapi' | 'qsv';

export interface EncodingChoice {
  videoEncoder: string;
  hwAccel: HwAccel;
  preset: string;
}

/**
 * Probes FFmpeg for hardware encoders. Result is cached for the process and
 * always falls back to libx264 so a mis-detection can never stop a broadcast.
 */
let cached: EncodingChoice | null = null;

export async function detectEncoder(): Promise<EncodingChoice> {
  if (cached) return cached;
  if (config.HW_ACCEL === 'off') {
    cached = { videoEncoder: 'libx264', hwAccel: 'off', preset: 'veryfast' };
    return cached;
  }

  const ffmpeg = resolveFfmpeg();
  let encoders = '';
  try {
    const { stdout } = await execFileAsync(ffmpeg, ['-hide_banner', '-encoders'], { timeout: 15_000 });
    encoders = stdout;
  } catch (err) {
    logger.warn('ffmpeg', 'Could not query ffmpeg encoders', { error: (err as Error).message });
  }

  const has = (name: string) => encoders.includes(name);
  const driExists = fs.existsSync('/dev/dri');

  let choice: EncodingChoice = { videoEncoder: 'libx264', hwAccel: 'off', preset: 'veryfast' };

  if ((config.HW_ACCEL === 'auto' || config.HW_ACCEL === 'nvidia') && has('h264_nvenc')) {
    choice = { videoEncoder: 'h264_nvenc', hwAccel: 'nvidia', preset: 'p4' };
  } else if ((config.HW_ACCEL === 'auto' || config.HW_ACCEL === 'vaapi') && has('h264_vaapi') && driExists) {
    choice = { videoEncoder: 'h264_vaapi', hwAccel: 'vaapi', preset: 'veryfast' };
  } else if ((config.HW_ACCEL === 'auto' || config.HW_ACCEL === 'qsv') && has('h264_qsv')) {
    choice = { videoEncoder: 'h264_qsv', hwAccel: 'qsv', preset: 'veryfast' };
  }

  logger.info('ffmpeg', `Video encoder selected: ${choice.videoEncoder}`, { hwAccel: choice.hwAccel });
  cached = choice;
  return choice;
}

/** Test-only escape hatch. */
export function resetEncoderCache(): void {
  cached = null;
}
