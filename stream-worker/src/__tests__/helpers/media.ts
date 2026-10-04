import { execFileSync } from 'node:child_process';

/**
 * Shared helpers for tests that need the real `ffmpeg` binary.
 *
 * MatchCast is an ffmpeg-driven product, but ffmpeg is an *external*
 * dependency: a contributor (or a slim CI container) may not have it on PATH.
 * Media tests must therefore degrade to "skipped" instead of exploding with
 * ENOENT - while every runnable assertion still runs where ffmpeg exists.
 *
 * The helper deliberately does not go through `resolveFfmpeg()` so it reports
 * the state of the machine itself, not the value of `FFMPEG_PATH`.
 */

/** True when a working `ffmpeg` is on PATH. */
export function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore', timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

/** Cached once per test process - the binary does not appear mid-run. */
export const FFMPEG_AVAILABLE = hasFfmpeg();

/** Human-readable reason used in `describe.skipIf` names. */
export const FFMPEG_SKIP_REASON = 'ffmpeg is not installed on this machine';
