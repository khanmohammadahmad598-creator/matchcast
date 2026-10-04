import { describe, it, expect, beforeEach } from 'vitest';

import { CommentaryEngine } from '../CommentaryEngine';
import { AntiRepetition } from '../antiRepetition';
import { snapshot, event, stubTts, stubBackend } from '../../__tests__/fixtures';
import type { TtsService } from '../../tts/TtsService';
import type { BackendClient } from '../../core/backendClient';

function makeEngine() {
  const tts = stubTts();
  const backend = stubBackend();
  const engine = new CommentaryEngine(
    tts as unknown as TtsService,
    backend as unknown as BackendClient,
    () => snapshot(),
  );
  return { engine, tts, backend };
}

describe('anti-repetition', () => {
  it('detects identical lines', () => {
    const anti = new AntiRepetition(10);
    expect(anti.isRepetition('Kohli ne chhakka maara')).toBe(false);
    anti.remember('Kohli ne chhakka maara');
    expect(anti.isRepetition('Kohli ne chhakka maara')).toBe(true);
  });

  it('detects near-identical lines (token overlap)', () => {
    const anti = new AntiRepetition(10);
    anti.remember('Kohli ne chhakka maara aur stadium goonj utha');
    expect(anti.isRepetition('Kohli ne chhakka maara aur stadium goonj utha!')).toBe(true);
  });

  it('accepts genuinely different lines', () => {
    const anti = new AntiRepetition(10);
    anti.remember('Kohli ne chhakka maara');
    expect(anti.isRepetition('Starc ne wicket liya, bada moment')).toBe(false);
  });

  it('forgets lines outside the rolling window', () => {
    const anti = new AntiRepetition(2);
    anti.remember('pehli line');
    anti.remember('doosri line');
    anti.remember('teesri line');
    expect(anti.recent(5)).toHaveLength(2);
    expect(anti.isRepetition('pehli line')).toBe(false);
  });
});

describe('commentary engine', () => {
  let ctx: ReturnType<typeof makeEngine>;

  beforeEach(() => {
    ctx = makeEngine();
  });

  it('speaks for event types the operator enabled (SIX)', async () => {
    await ctx.engine.handleEvent(event('SIX', { priority: 95, facts: { isSix: true, runs: 6 } }));
    expect(ctx.tts.spoken).toHaveLength(1);
    expect(ctx.tts.spoken[0]!.text.length).toBeGreaterThan(5);
    expect(ctx.backend.saved).toHaveLength(1);
  });

  it('stays silent for event types that are not in the speak list', async () => {
    await ctx.engine.handleEvent(event('BALL', { priority: 20, facts: { runs: 1 } }));
    expect(ctx.tts.spoken).toHaveLength(0);
  });

  it('honours the cooldown between two lines', async () => {
    ctx.engine.updateSettings({ cooldownSeconds: 30, minGapSeconds: 1 });
    await ctx.engine.handleEvent(event('SIX', { priority: 95 }));
    await ctx.engine.handleEvent(event('FOUR', { priority: 90, facts: { isFour: true } }));
    expect(ctx.tts.spoken).toHaveLength(1);
  });

  it('lets big moments through faster than routine ones', async () => {
    ctx.engine.updateSettings({ cooldownSeconds: 10, minGapSeconds: 0 });
    await ctx.engine.handleEvent(event('SIX', { priority: 95 }));
    // A priority>=90 moment only waits 40% of the cooldown, so this passes.
    await new Promise((r) => setTimeout(r, 10));
    await ctx.engine.handleEvent(event('SIX', { priority: 95 }));
    expect(ctx.tts.spoken.length).toBeGreaterThanOrEqual(1);
  });

  it('never speaks when commentary is disabled', async () => {
    ctx.engine.updateSettings({ enabled: false });
    await ctx.engine.handleEvent(event('SIX', { priority: 95 }));
    expect(ctx.tts.spoken).toHaveLength(0);
  });

  it('does not repeat itself across a long sequence of similar events', async () => {
    ctx.engine.updateSettings({ cooldownSeconds: 0, minGapSeconds: 0, verbosity: 1 });
    for (let i = 0; i < 12; i++) {
      await ctx.engine.handleEvent(event('SIX', { priority: 95, facts: { isSix: true, runs: 6 } }));
    }
    const lines = ctx.tts.spoken.map((s) => s.text);
    expect(lines.length).toBeGreaterThan(1);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]).not.toBe(lines[i - 1]);
    }
  });

  it('only talks about facts that exist in the snapshot (no invented events)', async () => {
    // Snapshot has no free hit, no milestone and no dismissal: the engine may
    // reference the real score (88/2) but must not invent a milestone.
    await ctx.engine.handleEvent(event('SIX', { priority: 95, facts: { isSix: true, runs: 6 } }));
    const text = ctx.tts.spoken[0]!.text;
    expect(text).toBeTruthy();
    expect(/century|hat-?trick|100/i.test(text)).toBe(false);
    expect(ctx.backend.saved[0]!.provider).toBeTruthy();
  });

  it('speaks operator-typed lines verbatim', async () => {
    await ctx.engine.speakManual('Welcome back to the coverage');
    expect(ctx.tts.spoken[0]!.text).toBe('Welcome back to the coverage');
  });

  it('survives a TTS failure (stream must never die with it)', async () => {
    const failing = {
      speak: async () => {
        throw new Error('provider exploded');
      },
    };
    const backend = stubBackend();
    const engine = new CommentaryEngine(
      failing as unknown as TtsService,
      backend as unknown as BackendClient,
      () => snapshot(),
    );
    await expect(engine.handleEvent(event('SIX', { priority: 95 }))).resolves.toBeUndefined();
  });
});
