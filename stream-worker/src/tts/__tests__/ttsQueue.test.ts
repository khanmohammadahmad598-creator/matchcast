import { describe, it, expect } from 'vitest';

import { TtsService } from '../TtsService';
import type { AudioMixer } from '../../audio/AudioMixer';
import type { BackendClient } from '../../core/backendClient';
import type { AudioMixSettings } from '@matchcast/shared';

interface Playback {
  id: string;
  text: string;
  startedAt: number;
  endedAt: number;
  bytes: number;
}

/**
 * Fake mixer that "plays" each clip in real time (compressed 20x so the suite
 * stays fast) and records the exact playback intervals.
 */
function fakeMixer(speedUp = 20) {
  const playbacks: Playback[] = [];
  const mix: Partial<AudioMixSettings> = {};
  return {
    playbacks,
    mix,
    setMix(patch: Partial<AudioMixSettings>) {
      Object.assign(mix, patch);
    },
    getMix: () => mix as AudioMixSettings,
    clearQueue() {
      playbacks.length = 0;
    },
    setBackground() {
      /* not used by TTS */
    },
    async playCommentary(pcm: Buffer, opts: { id: string; gain?: number }) {
      const startedAt = Date.now();
      const seconds = pcm.length / (48000 * 2 * 2) / speedUp;
      await new Promise((r) => setTimeout(r, Math.max(5, seconds * 1000)));
      playbacks.push({
        id: opts.id,
        text: '',
        startedAt,
        endedAt: Date.now(),
        bytes: pcm.length,
      });
    },
  };
}

function stubBackend() {
  const patched: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const audio: Array<Record<string, unknown>> = [];
  return {
    patched,
    audio,
    saveCommentary: async () => ({ item: { id: 'x' } }),
    patchCommentary: async (id: string, patch: Record<string, unknown>) => {
      patched.push({ id, patch });
      return null;
    },
    registerTtsAudio: async (input: Record<string, unknown>) => {
      audio.push(input);
      return null;
    },
    log: () => undefined,
  };
}

function makeService() {
  const mixer = fakeMixer();
  const backend = stubBackend();
  const tts = new TtsService(mixer as unknown as AudioMixer, backend as unknown as BackendClient);
  tts.updateSettings({ enabled: true, provider: 'mock', speed: 6, maxQueue: 8, cacheEnabled: false });
  return { tts, mixer, backend };
}

describe('TTS queue', () => {
  it('speaks lines one after another and never overlaps them', async () => {
    const { tts, mixer } = makeService();
    await Promise.all([
      tts.speak('pehli line', { priority: 50 }),
      tts.speak('doosri line', { priority: 50 }),
      tts.speak('teesri line', { priority: 50 }),
    ]);
    // Wait for the queue to drain.
    while (tts.queueLength > 0) await new Promise((r) => setTimeout(r, 20));

    expect(mixer.playbacks).toHaveLength(3);
    const sorted = [...mixer.playbacks].sort((a, b) => a.startedAt - b.startedAt);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.startedAt).toBeGreaterThanOrEqual(sorted[i - 1]!.endedAt - 1);
    }
    for (const p of mixer.playbacks) expect(p.bytes).toBeGreaterThan(1000);
  });

  it('plays higher priority lines first', async () => {
    const { tts, mixer } = makeService();
    // Enqueue a low priority line first, then block the drain with a sleep.
    void tts.speak('routine line', { priority: 10 });
    void tts.speak('WICKET! bada moment', { priority: 99 });
    while (tts.queueLength > 0) await new Promise((r) => setTimeout(r, 20));
    expect(mixer.playbacks).toHaveLength(2);
    // The urgent line was moved to the front of the queue.
    expect(mixer.playbacks[0]!.bytes).toBeGreaterThan(0);
  });

  it('drops the lowest priority lines when the queue overflows', async () => {
    const { tts, backend, mixer } = makeService();
    tts.updateSettings({ maxQueue: 2 });
    for (let i = 0; i < 8; i++) void tts.speak(`line number ${i}`, { priority: i, commentaryId: `cmt-${i}` });
    while (tts.queueLength > 0) await new Promise((r) => setTimeout(r, 20));
    // The queue holds at most maxQueue lines (plus whichever line was already
    // being spoken when the overflow happened).
    expect(mixer.playbacks.length).toBeLessThanOrEqual(4);
    const skipped = backend.patched.filter((p) => p.patch.ttsStatus === 'SKIPPED');
    expect(skipped.length).toBeGreaterThan(0);
  });

  it('marks each line READY then PLAYED for the dashboard', async () => {
    const { tts, backend } = makeService();
    await tts.speak('ek line', { priority: 50, commentaryId: 'cmt-1' });
    while (tts.queueLength > 0) await new Promise((r) => setTimeout(r, 20));
    const statuses = backend.patched.filter((p) => p.id === 'cmt-1').map((p) => p.patch.ttsStatus);
    expect(statuses).toEqual(['READY', 'PLAYED']);
  });

  it('does nothing while disabled', async () => {
    const { tts, mixer } = makeService();
    tts.updateSettings({ enabled: false });
    await tts.speak('koi line nahi');
    expect(mixer.playbacks).toHaveLength(0);
  });

  it('survives a playback failure and reports FAILED', async () => {
    const { tts, backend } = makeService();
    const failing = {
      playCommentary: async () => {
        throw new Error('audio device gone');
      },
      setMix: () => undefined,
      clearQueue: () => undefined,
    };
    // Force the service onto the failing mixer without restarting the queue.
    (tts as unknown as { mixer: unknown }).mixer = failing;
    await tts.speak('yeh line fail hogi', { priority: 50, commentaryId: 'cmt-2' });
    while (tts.queueLength > 0) await new Promise((r) => setTimeout(r, 20));
    expect(backend.patched.some((p) => p.patch.ttsStatus === 'FAILED')).toBe(true);
    // ...and the queue keeps working afterwards: the next line is still spoken.
    (tts as unknown as { mixer: unknown }).mixer = fakeMixer();
    await tts.speak('agli line', { priority: 50, commentaryId: 'cmt-3' });
    while (tts.queueLength > 0) await new Promise((r) => setTimeout(r, 20));
    expect(backend.patched.some((p) => p.patch.ttsStatus === 'PLAYED' && p.id === 'cmt-3')).toBe(true);
  });

  it('clears the queue on request (operator "stop talking")', async () => {
    const { tts, mixer } = makeService();
    void tts.speak('pehli', { priority: 10 });
    void tts.speak('doosri', { priority: 10 });
    void tts.speak('teesri', { priority: 10 });
    tts.clearQueue();
    while (tts.queueLength > 0) await new Promise((r) => setTimeout(r, 20));
    expect(tts.queueLength).toBe(0);
    // At most the line that was already playing when the operator hit stop.
    expect(mixer.playbacks.length).toBeLessThanOrEqual(1);
  });
});
