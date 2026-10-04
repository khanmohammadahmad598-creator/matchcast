import fs from 'node:fs';
import type { ScoreSnapshot } from '@matchcast/shared';

/**
 * Bridge to the graphics worker.
 *
 * The graphics worker writes raw RGBA frames into a named pipe that FFmpeg
 * reads as a second input. If that pipe has no writer (worker down, first boot)
 * we degrade to a dynamic `drawtext` score bug instead of blocking the stream.
 */
export class OverlayInput {
  constructor(private fifoPath: string, private textFilePath: string) {}

  /** True when the graphics worker currently has the pipe open for writing. */
  hasWriter(): boolean {
    try {
      if (!fs.existsSync(this.fifoPath)) return false;
      // Opening a FIFO read-only with O_NONBLOCK succeeds only if a writer is attached.
      const fd = fs.openSync(this.fifoPath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
      fs.closeSync(fd);
      return true;
    } catch {
      return false;
    }
  }

  /** Degraded-mode bug text, rewritten on every score change. */
  writeTextFile(snapshot: ScoreSnapshot | null): void {
    if (!snapshot) {
      try {
        fs.writeFileSync(this.textFilePath, ' ');
      } catch {
        /* ignore */
      }
      return;
    }
    const parts: string[] = [
      `${snapshot.battingTeam.shortName} ${snapshot.runs}/${snapshot.wickets}`,
      `(${snapshot.overs})`,
    ];
    if (snapshot.target) parts.push(`chasing ${snapshot.target}`);
    if (snapshot.requiredRunRate) parts.push(`RRR ${snapshot.requiredRunRate.toFixed(2)}`);
    else parts.push(`RR ${snapshot.runRate.toFixed(2)}`);
    if (snapshot.striker) parts.push(`${snapshot.striker.name} ${snapshot.striker.runs}(${snapshot.striker.balls})`);
    if (snapshot.bowler) parts.push(`${snapshot.bowler.name} ${snapshot.bowler.wickets}/${snapshot.bowler.runs}`);
    try {
      fs.writeFileSync(this.textFilePath, parts.join('  |  '));
    } catch {
      /* ignore */
    }
  }

  get textPath(): string {
    return this.textFilePath;
  }
}
