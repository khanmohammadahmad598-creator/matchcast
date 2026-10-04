import { execFile, execFileSync } from 'node:child_process';
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

/**
 * Per-encoder probe result cache.
 *
 * `ffmpeg -encoders` only tells us an encoder was *compiled in* - a distro
 * build always lists h264_nvenc even on machines without an NVIDIA driver, and
 * picking it means the pipeline dies with
 * "Cannot load libcuda.so.1" a few seconds into a live broadcast. So every
 * candidate is asked to encode one frame before it is trusted.
 */
const probes = new Map<string, boolean>();

function encoderWorks(ffmpeg: string, encoder: string): boolean {
  const cachedProbe = probes.get(encoder);
  if (cachedProbe !== undefined) return cachedProbe;

  let ok = false;
  try {
    execFileSync(
      ffmpeg,
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=256x144:rate=25',
        '-frames:v', '1',
        '-c:v', encoder,
        '-f', 'null', '-',
      ],
      { stdio: 'ignore', timeout: 20_000 },
    );
    ok = true;
  } catch (err) {
    logger.debug('ffmpeg', `Encoder probe failed: ${encoder}`, { error: (err as Error).message.split('\n')[0] });
    ok = false;
  }

  probes.set(encoder, ok);
  return ok;
}

/** Extra ffmpeg args a hardware encoder needs for the probe to be meaningful. */
function driNode(): string | null {
  try {
    const entries = fs.readdirSync('/dev/dri').filter((f) => f.startsWith('renderD'));
    return entries.length ? `/dev/dri/${entries[0]}` : null;
  } catch {
    return null;
  }
}

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

  const compiled = (name: string) => encoders.includes(name);
  /** Compiled in *and* able to encode a frame on this host right now. */
  const usable = (name: string) => compiled(name) && encoderWorks(ffmpeg, name);

  let choice: EncodingChoice = { videoEncoder: 'libx264', hwAccel: 'off', preset: 'veryfast' };

  if ((config.HW_ACCEL === 'auto' || config.HW_ACCEL === 'nvidia') && usable('h264_nvenc')) {
    choice = { videoEncoder: 'h264_nvenc', hwAccel: 'nvidia', preset: 'p4' };
  } else if (
    (config.HW_ACCEL === 'auto' || config.HW_ACCEL === 'vaapi') &&
    compiled('h264_vaapi') &&
    driNode() !== null &&
    usable('h264_vaapi')
  ) {
    choice = { videoEncoder: 'h264_vaapi', hwAccel: 'vaapi', preset: 'veryfast' };
  } else if ((config.HW_ACCEL === 'auto' || config.HW_ACCEL === 'qsv') && usable('h264_qsv')) {
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
