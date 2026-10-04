/**
 * Pure cricket scoring maths. No I/O, no side effects -> unit-testable.
 * Overs are stored as decimals (18.4 = 18 overs + 4 balls).
 */

/** "18.4" -> 112 legal balls */
export function oversToBalls(overs: number): number {
  const whole = Math.floor(overs + 1e-9);
  const frac = Math.round((overs - whole) * 10);
  return whole * 6 + frac;
}

/** 112 -> 18.4 */
export function ballsToOvers(balls: number): number {
  const overs = Math.floor(balls / 6);
  const rem = balls % 6;
  return Number(`${overs}.${rem}`);
}

export function formatOvers(balls: number): string {
  return ballsToOvers(balls).toFixed(1);
}

export function runRate(runs: number, balls: number): number {
  if (balls <= 0) return 0;
  return round(runs / (balls / 6), 2);
}

export function requiredRunRate(target: number, runs: number, ballsBowled: number, maxBalls: number): number | null {
  if (!target || maxBalls <= 0) return null;
  const ballsLeft = maxBalls - ballsBowled;
  if (ballsLeft <= 0) return null;
  const runsLeft = target - runs + 1; // target is "runs to win", so chase = target+1 to win
  return round(runsLeft / (ballsLeft / 6), 2);
}

export function runsRequired(target: number, runs: number): number | null {
  if (target == null) return null;
  return Math.max(0, target - runs + 1);
}

export function projectedScore(runs: number, balls: number, maxBalls: number): number | null {
  if (balls <= 0 || maxBalls <= 0) return null;
  const rr = runs / (balls / 6);
  return Math.round(runs + (rr * (maxBalls - balls)) / 6);
}

export function strikeRate(runs: number, balls: number): number {
  if (balls <= 0) return 0;
  return round((runs / balls) * 100, 2);
}

export function economy(runsConceded: number, balls: number): number {
  if (balls <= 0) return 0;
  return round(runsConceded / (balls / 6), 2);
}

export function oversBowled(balls: number): number {
  const o = Math.floor(balls / 6);
  const b = balls % 6;
  return Number(`${o}.${b}`);
}

export function formatMaxOvers(format: string, customOvers?: number | null): number | null {
  switch (format) {
    case 'T20':
      return 120;
    case 'ODI':
      return 300;
    case 'T10':
      return 60;
    case 'HUNDRED':
      return 100;
    case 'CUSTOM':
      return customOvers ? customOvers * 6 : null;
    default:
      return null; // TEST - unlimited
  }
}

/** Is this ball legal (counts towards the over)? */
export function isLegalDelivery(extraType?: string | null): boolean {
  return extraType !== 'WD' && extraType !== 'NB';
}

/** Label drawn on the scoreboard for a ball. */
export function ballLabel(input: {
  runs: number;
  batterRuns: number;
  isWicket: boolean;
  extraType?: string | null;
}): string {
  if (input.isWicket) return 'W';
  if (input.extraType === 'WD') return input.runs > 1 ? `${input.runs - 1}wd` : 'wd';
  if (input.extraType === 'NB') return input.runs > 1 ? `${input.runs - 1}nb` : 'nb';
  if (input.extraType === 'LB') return `${input.runs - 1}lb`;
  if (input.extraType === 'B') return `${input.runs - 1}b`;
  if (input.runs === 0) return '.';
  return String(input.runs);
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
