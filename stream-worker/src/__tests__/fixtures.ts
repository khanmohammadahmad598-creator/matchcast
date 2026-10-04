import type { MatchEvent, MatchEventType, ScoreSnapshot } from '@matchcast/shared';

/** Minimal but realistic score snapshot used by the worker test suites. */
export function snapshot(patch: Partial<ScoreSnapshot> = {}): ScoreSnapshot {
  return {
    matchId: '11111111-1111-1111-1111-111111111111',
    inningsId: '22222222-2222-2222-2222-222222222222',
    inningsNumber: 1,
    status: 'LIVE',
    format: 'T20',
    title: 'Vitest XI vs Backend XI',
    tournament: 'Unit Test Series',
    venue: 'Kanpur',
    battingTeam: { id: 'team-a', name: 'India', shortName: 'IND' },
    bowlingTeam: { id: 'team-b', name: 'Australia', shortName: 'AUS' },
    runs: 88,
    wickets: 2,
    overs: 7.2,
    legalBalls: 44,
    target: 180,
    maxOvers: 20,
    runRate: 12.0,
    requiredRunRate: 8.4,
    runsRequired: 92,
    ballsRemaining: 76,
    projectedScore: 176,
    striker: {
      id: 'p1',
      name: 'V Kohli',
      runs: 41,
      balls: 22,
      fours: 3,
      sixes: 2,
      strikeRate: 186.36,
      onStrike: true,
    },
    nonStriker: {
      id: 'p2',
      name: 'R Sharma',
      runs: 22,
      balls: 15,
      fours: 1,
      sixes: 1,
      strikeRate: 146.66,
      onStrike: false,
    },
    bowler: { id: 'p9', name: 'M Starc', overs: 2.2, maidens: 0, runs: 24, wickets: 1, economy: 10.28 },
    partnership: { runs: 34, balls: 18 },
    extras: { wides: 3, noBalls: 1, byes: 2, legByes: 0, penalties: 0, total: 6 },
    freeHit: false,
    recentBalls: [
      {
        id: 'b1',
        over: 7,
        ballInOver: 2,
        label: '6',
        runs: 6,
        batterRuns: 6,
        isExtra: false,
        isWicket: false,
        isLegal: true,
        isFour: false,
        isSix: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'b2',
        over: 7,
        ballInOver: 1,
        label: '1',
        runs: 1,
        batterRuns: 1,
        isExtra: false,
        isWicket: false,
        isLegal: true,
        isFour: false,
        isSix: false,
        createdAt: new Date().toISOString(),
      },
    ],
    version: 1,
    updatedAt: new Date().toISOString(),
    ...patch,
  };
}

export function event(type: MatchEventType, patch: Partial<MatchEvent> = {}): MatchEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    type,
    matchId: '11111111-1111-1111-1111-111111111111',
    headline: `${type} event`,
    facts: {},
    priority: 80,
    createdAt: new Date().toISOString(),
    ...patch,
  };
}

/** Stub TTS service: records what the engine asked it to say. */
export function stubTts() {
  const spoken: Array<{ text: string; priority?: number }> = [];
  return {
    spoken,
    speak: async (text: string, opts: { priority?: number } = {}) => {
      spoken.push({ text, priority: opts.priority });
    },
  };
}

/** Stub control-plane client: records persisted commentary rows. */
export function stubBackend() {
  const saved: Array<Record<string, unknown>> = [];
  const patched: Array<{ id: string; patch: Record<string, unknown> }> = [];
  return {
    saved,
    patched,
    saveCommentary: async (input: Record<string, unknown>) => {
      saved.push(input);
      return { item: { id: `cmt-${saved.length}` } };
    },
    patchCommentary: async (id: string, patch: Record<string, unknown>) => {
      patched.push({ id, patch });
      return null;
    },
    registerTtsAudio: async () => null,
    log: () => undefined,
  };
}
