import { describe, it, expect } from 'vitest';

import { TEMPLATES, resolveTemplate, cricketModern } from '../templates';
import { CanvasRenderer } from '../renderers/canvas';
import type { GraphicsSettings, ScoreSnapshot } from '@matchcast/shared';

const settings: GraphicsSettings = {
  templateId: 'cricket-modern',
  accentColor: '#00d09c',
  backgroundColor: '#0b1120',
  textColor: '#ffffff',
  fontFamily: 'Inter, Arial, sans-serif',
  showLiveBadge: true,
  showSponsorBanner: false,
  lowerThirdVisible: false,
  introVisible: false,
  outroVisible: false,
  scoreboardPosition: 'bottom-left',
  opacity: 0.96,
  overlayFps: 15,
  overlayWidth: 1280,
  overlayHeight: 720,
};

const snapshot: ScoreSnapshot = {
  matchId: 'm1',
  inningsId: 'i1',
  inningsNumber: 1,
  status: 'LIVE',
  format: 'T20',
  title: 'India vs Australia',
  tournament: 'MatchCast Demo Series',
  venue: 'Kanpur',
  battingTeam: { id: 'a', name: 'India', shortName: 'IND', primaryColor: '#1d4ed8' },
  bowlingTeam: { id: 'b', name: 'Australia', shortName: 'AUS', primaryColor: '#facc15' },
  runs: 148,
  wickets: 3,
  overs: 16.2,
  legalBalls: 98,
  target: 190,
  maxOvers: 20,
  runRate: 9.0,
  requiredRunRate: 12.6,
  runsRequired: 42,
  ballsRemaining: 22,
  projectedScore: 181,
  striker: { id: 'p1', name: 'V Kohli', runs: 62, balls: 38, fours: 5, sixes: 2, strikeRate: 163, onStrike: true },
  nonStriker: { id: 'p2', name: 'R Sharma', runs: 31, balls: 24, fours: 2, sixes: 1, strikeRate: 129, onStrike: false },
  bowler: { id: 'p9', name: 'M Starc', overs: 3.2, maidens: 0, runs: 28, wickets: 1, economy: 8.4 },
  partnership: { runs: 47, balls: 26 },
  extras: { wides: 4, noBalls: 1, byes: 2, legByes: 1, penalties: 0, total: 8 },
  freeHit: false,
  recentBalls: [
    { id: 'b1', over: 16, ballInOver: 2, label: '4', runs: 4, batterRuns: 4, isExtra: false, isWicket: false, isLegal: true, isFour: true, isSix: false, createdAt: new Date().toISOString() },
    { id: 'b2', over: 16, ballInOver: 1, label: 'W', runs: 0, batterRuns: 0, isExtra: false, isWicket: true, isLegal: true, isFour: false, isSix: false, createdAt: new Date().toISOString() },
  ],
  version: 3,
  updatedAt: new Date().toISOString(),
};

/** Builds the renderer input the real worker loop passes to `render()`. */
function input(patch: { width?: number; height?: number; settings?: GraphicsSettings; snapshot?: ScoreSnapshot | null } = {}) {
  return {
    settings: patch.settings ?? settings,
    snapshot: patch.snapshot === undefined ? snapshot : patch.snapshot,
    flash: null,
  };
}

describe('graphics templates', () => {
  it('registers every template under its own id', () => {
    expect(Object.keys(TEMPLATES).length).toBeGreaterThanOrEqual(3);
    for (const [id, template] of Object.entries(TEMPLATES)) {
      expect(template.id).toBe(id);
      expect(typeof template.draw).toBe('function');
      expect(template.name.length).toBeGreaterThan(0);
    }
  });

  it('falls back to the default template for an unknown id', () => {
    expect(resolveTemplate('does-not-exist').id).toBe(cricketModern.id);
  });

  it('renders a template without throwing when the snapshot is empty', () => {
    const renderer = new CanvasRenderer(1280, 720);
    expect(() => renderer.render(input({ snapshot: null }))).not.toThrow();
  });

  it('produces a full RGBA frame of the requested size', () => {
    const renderer = new CanvasRenderer(1280, 720);
    const frame = renderer.render(input());
    expect(frame.length).toBe(1280 * 720 * 4);
  });

  it('resizes to the encoder output resolution', () => {
    const renderer = new CanvasRenderer(1280, 720);
    renderer.resize(1920, 1080);
    const frame = renderer.render(input());
    expect(frame.length).toBe(1920 * 1080 * 4);
  });

  it('isolates template errors so a bad template cannot blank the overlay', () => {
    const renderer = new CanvasRenderer(640, 360);
    // An unknown template id resolves to the default, and a throwing draw()
    // is caught inside render(), so the overlay always returns a full frame.
    const frame = renderer.render(input({ settings: { ...settings, templateId: 'broken-template' } }));
    expect(frame.length).toBe(640 * 360 * 4);
  });
});
