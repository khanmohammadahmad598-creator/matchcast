import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { FFMPEG_AVAILABLE, FFMPEG_SKIP_REASON } from '../../__tests__/helpers/media';
import { ReplayBuffer, atempoChain } from '../ReplayBuffer';
import type { BackendClient } from '../../core/backendClient';
import type { MatchEvent, ReplaySettings } from '@matchcast/shared';

/**
 * Replay buffer tests.
 *
 * They use real (tiny) ffmpeg-generated MPEG-TS segments, so the concat graph,
 * slow-motion filter chain and duration probe are exercised the way they run in
 * production - only the recording pipeline is stubbed out.
 */

let dir: string;
interface RecordedClip {
  matchId: string;
  eventType: string;
  filePath: string;
  durationSeconds: number;
  inserted: boolean;
}

const created: RecordedClip[] = [];

const backend = {
  createReplayClip: async (clip: never) => {
    created.push(clip as never);
    return { id: 'clip' };
  },
} as unknown as BackendClient;

const event = (type: MatchEvent['type'], id = 'evt-1'): MatchEvent => ({
  id,
  type,
  matchId: '00000000-0000-0000-0000-000000000000',
  headline: `${type} test`,
  facts: { isSix: type === 'SIX', isWicket: type === 'WICKET' },
  priority: 5,
  createdAt: new Date().toISOString(),
});

const SETTINGS = (patch: Partial<ReplaySettings> = {}): ReplaySettings => ({
  enabled: true,
  preRollSeconds: 2,
  postRollSeconds: 0, // no artificial delay in tests
  mode: 'off',
  playbackRate: 1,
  maxLatencySeconds: 6,
  triggerEvents: ['SIX', 'WICKET', 'MILESTONE'],
  ...patch,
});

const clips = () => fs.readdirSync(dir).filter((f) => f.startsWith('replay-') && f.endsWith('.mp4'));

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('condition not met within timeout');
}

/** Builds three 1-second segments (video + audio) that look like the ring buffer. */
function seedSegments(count = 3): void {
  for (let i = 0; i < count; i++) {
    const out = path.join(dir, `seg_${String(i).padStart(3, '0')}.ts`);
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
        '-t', '1',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '64k', '-ar', '48000', '-ac', '2',
        '-f', 'mpegts', out,
      ],
      { stdio: 'ignore' },
    );
    // Distinct mtimes so the ring ordering is deterministic.
    const when = new Date(Date.now() - (count - i) * 1000);
    fs.utimesSync(out, when, when);
  }
}

beforeAll(() => {
  if (!FFMPEG_AVAILABLE) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matchcast-replay-'));
  seedSegments(3);
});
afterAll(() => {
  if (!FFMPEG_AVAILABLE) return; // beforeAll never created the fixture dir
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('atempoChain', () => {
  it('returns null when no audio stretching is needed', () => {
    expect(atempoChain(1)).toBeNull();
    expect(atempoChain(0)).toBeNull();
  });

  it('slows audio down for slow motion', () => {
    expect(atempoChain(0.6)).toBe('atempo=0.600');
  });

  it('chains factors below ffmpeg\'s 0.5 atempo floor', () => {
    expect(atempoChain(0.3)).toBe('atempo=0.500,atempo=0.600');
  });

  it('speeds audio up for fast playback', () => {
    expect(atempoChain(1.5)).toBe('atempo=1.500');
  });
});

describe.skipIf(!FFMPEG_AVAILABLE)(FFMPEG_AVAILABLE ? 'ReplayBuffer' : `ReplayBuffer (${FFMPEG_SKIP_REASON})`, () => {
  it('ignores events while the buffer is disabled', () => {
    const buffer = new ReplayBuffer(backend, dir);
    buffer.updateSettings(SETTINGS({ enabled: false }));
    expect(buffer.onEvent(event('SIX'))).toBe(false);
  });

  it('ignores event types the operator did not select', () => {
    const buffer = new ReplayBuffer(backend, dir);
    buffer.updateSettings(SETTINGS());
    expect(buffer.onEvent(event('BALL'))).toBe(false);
  });

  it('ignores the same event twice (de-duplicated by event id)', () => {
    // An empty ring keeps this test from leaving a capture in flight.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'matchcast-replay-dedup-'));
    try {
      const buffer = new ReplayBuffer(backend, empty);
      buffer.updateSettings(SETTINGS());
      expect(buffer.onEvent(event('SIX', 'dup-1'))).toBe(true);
      expect(buffer.onEvent(event('SIX', 'dup-1'))).toBe(false);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('builds a clip from the segment ring and reports it to the backend', async () => {
    created.length = 0;
    for (const f of clips()) fs.rmSync(path.join(dir, f));

    const buffer = new ReplayBuffer(backend, dir, undefined, () => true);
    buffer.setSegmentSeconds(1);
    buffer.updateSettings(SETTINGS({ preRollSeconds: 3 }));

    expect(buffer.onEvent(event('SIX', 'clip-1'))).toBe(true);
    await waitFor(() => created.some((c) => c.filePath.includes('replay-six')));

    expect(created).toHaveLength(1);
    const clip = created[0];
    expect(path.basename(clip.filePath)).toMatch(/^replay-six-\d+\.mp4$/);
    expect(fs.existsSync(clip.filePath)).toBe(true);
    expect(clip.eventType).toBe('SIX');
    expect(clip.durationSeconds).toBeGreaterThan(0);
    expect(clip.inserted).toBe(false);
  });

  it('hands the clip to the pipeline only in "cut" mode while healthy', async () => {
    created.length = 0;
    const ready: string[] = [];
    const buffer = new ReplayBuffer(backend, dir, (clip) => ready.push(clip.filePath), () => true);
    buffer.setSegmentSeconds(1);
    buffer.updateSettings(SETTINGS({ mode: 'cut', preRollSeconds: 2 }));

    expect(buffer.onEvent(event('WICKET', 'clip-2'))).toBe(true);
    await waitFor(() => ready.length > 0);
    expect(path.basename(ready[0])).toMatch(/^replay-wicket-\d+\.mp4$/);

    // An unhealthy pipeline still archives the clip but must never cut away
    // from the live feed.
    created.length = 0;
    ready.length = 0;
    const unhealthy = new ReplayBuffer(backend, dir, (clip) => ready.push(clip.filePath), () => false);
    unhealthy.setSegmentSeconds(1);
    unhealthy.updateSettings(SETTINGS({ mode: 'cut' }));
    expect(unhealthy.onEvent(event('SIX', 'clip-3'))).toBe(true);
    await waitFor(() => created.length > 0);
    expect(created[0].eventType).toBe('SIX');
    expect(ready).toHaveLength(0);
  });

  it('skips the segment the ring is still writing (partial file breaks the concat)', async () => {
    created.length = 0;

    // The newest segment exists but is empty and was touched a moment ago -
    // exactly what the live ring looks like while ffmpeg is appending to it.
    const inFlight = path.join(dir, 'seg_999.ts');
    fs.writeFileSync(inFlight, '');

    const buffer = new ReplayBuffer(backend, dir);
    buffer.setSegmentSeconds(1);
    buffer.updateSettings(SETTINGS());

    expect(buffer.onEvent(event('SIX', 'clip-5'))).toBe(true);
    await waitFor(() => created.length > 0);

    // A clip was still produced (from the finished segments) instead of the
    // capture failing with "replay concat failed".
    expect(created[0].eventType).toBe('SIX');
    expect(created[0].durationSeconds).toBeGreaterThan(0);
    expect(fs.existsSync(created[0].filePath)).toBe(true);
    fs.rmSync(created[0].filePath, { force: true });
    fs.rmSync(inFlight, { force: true });
  });

  it('degrades gracefully when the ring is still empty (no clip, no crash)', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'matchcast-replay-empty-'));
    created.length = 0;
    try {
      const buffer = new ReplayBuffer(backend, empty);
      buffer.setSegmentSeconds(1);
      buffer.updateSettings(SETTINGS());

      expect(() => buffer.onEvent(event('MILESTONE', 'clip-4'))).not.toThrow();
      await new Promise((r) => setTimeout(r, 500));

      // Nothing was produced and the worker is still healthy - a missing ring
      // must never take the broadcast down.
      expect(created).toHaveLength(0);
      expect(fs.readdirSync(empty)).toHaveLength(0);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
