import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { logger } from './logger';

/**
 * Writes raw RGBA frames into the named pipe the FFmpeg pipeline reads.
 *
 * Robust to restarts: if the reader (FFmpeg) disappears we get EPIPE, drop the
 * stream and re-open. If there is no reader yet, frames are skipped instead of
 * queued forever - the overlay simply resumes once FFmpeg attaches.
 */
export class FrameWriter {
  private stream: fs.WriteStream | null = null;
  private opening = false;
  private ready = false;
  private dropped = 0;

  constructor(
    private fifoPath: string,
    private frameBytes: number,
  ) {}

  get isReady(): boolean {
    return this.ready && !!this.stream && !this.stream.destroyed;
  }

  /** Creates the FIFO if needed and opens it for writing (retries in background). */
  ensureOpen(): void {
    if (this.stream || this.opening) return;
    this.opening = true;
    try {
      if (!fs.existsSync(this.fifoPath)) {
        execSync(`mkfifo "${this.fifoPath}"`, { stdio: 'ignore' });
        logger.info('system', `Created graphics fifo: ${this.fifoPath}`);
      }
    } catch (err) {
      logger.warn('system', 'Could not create fifo', { error: (err as Error).message });
      this.opening = false;
      setTimeout(() => this.ensureOpen(), 2000).unref?.();
      return;
    }

    const stream = fs.createWriteStream(this.fifoPath, { flags: 'w' });
    stream.on('open', () => {
      this.ready = true;
      this.opening = false;
      logger.info('system', 'Graphics fifo attached (FFmpeg is reading)');
    });
    stream.on('error', (err) => {
      this.ready = false;
      this.opening = false;
      this.stream = null;
      logger.debug('system', 'Graphics fifo error - will retry', { error: err.message });
      setTimeout(() => this.ensureOpen(), 1000).unref?.();
    });
    this.stream = stream;
  }

  write(frame: Buffer): boolean {
    if (!this.isReady) {
      this.ensureOpen();
      this.dropped += 1;
      if (this.dropped % 100 === 1) {
        logger.debug('system', 'No FFmpeg reader attached - overlay frames are being skipped');
      }
      return false;
    }
    // Backpressure: never queue more than ~4 frames.
    if ((this.stream!.writableLength ?? 0) > this.frameBytes * 4) return false;
    try {
      this.stream!.write(frame);
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    try {
      this.stream?.end();
    } catch {
      /* ignore */
    }
    this.stream = null;
    this.ready = false;
  }
}
