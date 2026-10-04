import { prisma } from '../db/prisma';
import { logger } from '../core/logger';
import type { Innings, Match, Player, Team } from '@prisma/client';
import {
  ballsToOvers,
  ballLabel,
  economy,
  formatMaxOvers,
  isLegalDelivery,
  oversToBalls,
  projectedScore,
  requiredRunRate,
  runRate,
  runsRequired,
  strikeRate,
  uid,
  type BallSnapshot,
  type BatterSnapshot,
  type BowlerSnapshot,
  type MatchEvent,
  type MatchEventType,
  type ScoreSnapshot,
  type ScoreUpdateInput,
} from '@matchcast/shared';
import { ballInputSchema, type z } from '@matchcast/shared';

export class ScoreError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type BallInput = z.infer<typeof ballInputSchema>;

/* ------------------------------------------------------------------ */
/* Serialisation: two operators must never write the same innings at once */
/* ------------------------------------------------------------------ */

const locks = new Map<string, Promise<unknown>>();

export function withMatchLock<T>(matchId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(matchId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    matchId,
    next.catch(() => undefined),
  );
  return next;
}

/* ------------------------------------------------------------------ */
/* Loading helpers                                                     */
/* ------------------------------------------------------------------ */

interface LoadedMatch {
  match: Match & { teamA: Team; teamB: Team };
  innings: Innings | null;
  players: Map<string, Player>;
}

async function load(matchId: string): Promise<LoadedMatch> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { teamA: true, teamB: true },
  });
  if (!match) throw new ScoreError('Match not found', 404);
  const innings = await prisma.innings.findFirst({
    where: { matchId },
    orderBy: { number: 'desc' },
  });
  const players = await prisma.player.findMany({ where: { teamId: { in: [match.teamAId, match.teamBId] } } });
  return { match, innings, players: new Map(players.map((p) => [p.id, p])) };
}

function currentInnings(loaded: LoadedMatch): Innings {
  if (!loaded.innings) throw new ScoreError('No innings in progress - start the match first', 409);
  if (loaded.innings.isCompleted) throw new ScoreError('Current innings is complete - start the next innings', 409);
  return loaded.innings;
}

function teamOf(match: Match & { teamA: Team; teamB: Team }, id: string): Team {
  return match.teamAId === id ? match.teamA : match.teamB;
}

/* ------------------------------------------------------------------ */
/* Match lifecycle                                                     */
/* ------------------------------------------------------------------ */

export async function createMatch(dto: {
  title: string;
  tournament?: string | null;
  venue?: string | null;
  format: string;
  oversPerInnings?: number | null;
  startsAt?: string | null;
  teamA: { name: string; shortName: string; logoUrl?: string | null; primaryColor?: string | null; secondaryColor?: string | null; players: { name: string; role: string; jerseyNumber?: number | null }[] };
  teamB: { name: string; shortName: string; logoUrl?: string | null; primaryColor?: string | null; secondaryColor?: string | null; players: { name: string; role: string; jerseyNumber?: number | null }[] };
}) {
  const mkTeam = (t: typeof dto.teamA) => ({
    name: t.name,
    shortName: t.shortName,
    logoUrl: t.logoUrl ?? null,
    primaryColor: t.primaryColor ?? null,
    secondaryColor: t.secondaryColor ?? null,
    players: {
      create: t.players.map((p) => ({
        name: p.name,
        role: p.role as 'BAT' | 'BOWL' | 'AR' | 'WK',
        jerseyNumber: p.jerseyNumber ?? null,
      })),
    },
  });

  const match = await prisma.match.create({
    data: {
      title: dto.title,
      tournament: dto.tournament ?? null,
      venue: dto.venue ?? null,
      format: dto.format as Match['format'],
      oversPerInnings: dto.oversPerInnings ?? null,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      teamA: { create: mkTeam(dto.teamA) },
      teamB: { create: mkTeam(dto.teamB) },
    },
    include: { teamA: { include: { players: true } }, teamB: { include: { players: true } } },
  });
  logger.info('backend', `Match created: ${match.title}`, { matchId: match.id });
  return match;
}

export async function listMatches(take = 50) {
  return prisma.match.findMany({
    orderBy: { updatedAt: 'desc' },
    take,
    include: {
      teamA: true,
      teamB: true,
      innings: { orderBy: { number: 'desc' }, take: 1 },
    },
  });
}

export async function getMatchDetail(id: string) {
  const match = await prisma.match.findUnique({
    where: { id },
    include: {
      teamA: { include: { players: true } },
      teamB: { include: { players: true } },
      innings: { orderBy: { number: 'asc' } },
    },
  });
  if (!match) throw new ScoreError('Match not found', 404);
  return match;
}

export async function updateMatch(id: string, dto: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const k of ['title', 'tournament', 'venue', 'status']) {
    if (dto[k] !== undefined) data[k] = dto[k];
  }
  return prisma.match.update({ where: { id }, data });
}

/** Start the match: creates innings 1, sets openers + opening bowler. */
export async function startMatch(
  matchId: string,
  opts: { battingTeamId?: string; strikerId?: string; nonStrikerId?: string; bowlerId?: string },
) {
  return withMatchLock(matchId, async () => {
    const loaded = await load(matchId);
    const battingTeamId = opts.battingTeamId ?? loaded.match.teamAId;
    const bowlingTeamId = battingTeamId === loaded.match.teamAId ? loaded.match.teamBId : loaded.match.teamAId;

    const existing = await prisma.innings.findFirst({ where: { matchId, number: 1 } });
    if (existing) {
      await prisma.match.update({
        where: { id: matchId },
        data: { status: 'LIVE', battingTeamId, bowlingTeamId },
      });
      return prisma.innings.findFirst({ where: { matchId, number: 1 } });
    }

    const openers = pickOpeners(loaded, battingTeamId);
    const innings = await prisma.innings.create({
      data: {
        matchId,
        number: 1,
        battingTeamId,
        bowlingTeamId,
        strikerId: opts.strikerId ?? openers.strikerId,
        nonStrikerId: opts.nonStrikerId ?? openers.nonStrikerId,
        bowlerId: opts.bowlerId ?? pickBowler(loaded, bowlingTeamId),
      },
    });
    await prisma.match.update({
      where: { id: matchId },
      data: { status: 'LIVE', battingTeamId, bowlingTeamId },
    });
    logger.info('backend', `Match started, innings 1`, { matchId });
    return innings;
  });
}

/** Begin the next innings (also used for the innings break -> 2nd innings). */
export async function startNextInnings(
  matchId: string,
  opts: { strikerId?: string; nonStrikerId?: string; bowlerId?: string; target?: number | null } = {},
) {
  return withMatchLock(matchId, async () => {
    const loaded = await load(matchId);
    const last = await prisma.innings.findFirst({ where: { matchId }, orderBy: { number: 'desc' } });
    if (last && !last.isCompleted) {
      await prisma.innings.update({ where: { id: last.id }, data: { isCompleted: true } });
    }
    const number = (last?.number ?? 0) + 1;
    const battingTeamId = last
      ? last.battingTeamId === loaded.match.teamAId
        ? loaded.match.teamBId
        : loaded.match.teamAId
      : loaded.match.teamAId;
    const bowlingTeamId = battingTeamId === loaded.match.teamAId ? loaded.match.teamBId : loaded.match.teamAId;
    const target = opts.target ?? (last && last.number === 1 ? last.runs + 1 : null);

    const innings = await prisma.innings.create({
      data: {
        matchId,
        number,
        battingTeamId,
        bowlingTeamId,
        target,
        strikerId: opts.strikerId ?? pickOpeners(loaded, battingTeamId).strikerId,
        nonStrikerId: opts.nonStrikerId ?? pickOpeners(loaded, battingTeamId).nonStrikerId,
        bowlerId: opts.bowlerId ?? pickBowler(loaded, bowlingTeamId),
      },
    });
    await prisma.match.update({
      where: { id: matchId },
      data: { status: 'LIVE', battingTeamId, bowlingTeamId },
    });
    logger.info('backend', `Innings ${number} started`, { matchId, target });
    return innings;
  });
}

/* ------------------------------------------------------------------ */
/* The single write path: every delivery goes through commitBall()     */
/* ------------------------------------------------------------------ */

interface CommitInput {
  runs: number;
  batterRuns: number;
  extraType?: string | null;
  isWicket: boolean;
  wicketKind?: string | null;
  batterOutId?: string | null;
  newBatterId?: string | null;
  legalBallsToAdd: number;
  commentary?: string | null;
}

interface CommitResult {
  snapshot: ScoreSnapshot;
  events: MatchEvent[];
}

async function commitBall(matchId: string, input: CommitInput): Promise<CommitResult> {
  return withMatchLock(matchId, async () => {
    const loaded = await load(matchId);
    const innings = currentInnings(loaded);
    const legal = isLegalDelivery(input.extraType);

    const before = {
      runs: innings.runs,
      wickets: innings.wickets,
      strikerRuns: innings.strikerRuns,
      bowlerWickets: innings.bowlerWickets,
      legalBalls: innings.legalBalls,
    };

    const extrasUpdate: Record<string, number> = {};
    if (input.extraType === 'WD') extrasUpdate.wides = innings.wides + 1;
    if (input.extraType === 'NB') extrasUpdate.noBalls = innings.noBalls + 1;
    if (input.extraType === 'LB') extrasUpdate.legByes = innings.legByes + 1;
    if (input.extraType === 'B') extrasUpdate.byes = innings.byes + 1;
    if (input.extraType === 'P') extrasUpdate.penalties = innings.penalties + input.runs;

    const isWicket = input.isWicket;
    const overCompleteBefore = innings.legalBalls > 0 && innings.legalBalls % 6 === 0;
    const newLegalBalls = innings.legalBalls + input.legalBallsToAdd;
    const overCompletes = input.legalBallsToAdd > 0 && newLegalBalls % 6 === 0;

    // Bowler concedes everything except byes/leg-byes/penalties
    const chargedToBowler = !['LB', 'B', 'P'].includes(input.extraType ?? '');
    const bowlerWicket = isWicket && input.wicketKind !== 'RUN_OUT';

    const data: Record<string, unknown> = {
      runs: innings.runs + input.runs,
      wickets: innings.wickets + (isWicket ? 1 : 0),
      legalBalls: newLegalBalls,
      ...extrasUpdate,
      strikerRuns: innings.strikerRuns + input.batterRuns,
      strikerBalls: innings.strikerBalls + (legal ? input.legalBallsToAdd : 0),
      strikerFours: innings.strikerFours + (input.batterRuns === 4 ? 1 : 0),
      strikerSixes: innings.strikerSixes + (input.batterRuns === 6 ? 1 : 0),
      bowlerRuns: innings.bowlerRuns + (chargedToBowler ? input.runs : 0),
      bowlerBalls: innings.bowlerBalls + (legal ? input.legalBallsToAdd : 0),
      bowlerWickets: innings.bowlerWickets + (bowlerWicket ? 1 : 0),
      partnershipRuns: isWicket ? 0 : innings.partnershipRuns + input.runs,
      partnershipBalls: isWicket ? 0 : innings.partnershipBalls + (legal ? input.legalBallsToAdd : 0),
      freeHit: input.extraType === 'NB' ? true : legal ? false : innings.freeHit,
    };

    // --- strike rotation + new batter
    if (isWicket) {
      const outId = input.batterOutId ?? innings.strikerId;
      // If the operator/scorer did not nominate the next batter, send in the
      // next undismissed player from the batting order.
      data.strikerId = input.newBatterId ?? (await nextBatter(innings, loaded, outId ?? null));
      data.strikerRuns = 0;
      data.strikerBalls = 0;
      data.strikerFours = 0;
      data.strikerSixes = 0;
      void outId;
    } else {
      const rotate = input.batterRuns % 2 === 1;
      const swap = overCompletes || (!overCompleteBefore && rotate && input.batterRuns > 0);
      if (swap) {
        data.strikerId = innings.nonStrikerId;
        data.nonStrikerId = innings.strikerId;
        data.strikerRuns = innings.nonStrikerRuns;
        data.strikerBalls = innings.nonStrikerBalls;
        data.strikerFours = innings.nonStrikerFours;
        data.strikerSixes = innings.nonStrikerSixes;
        data.nonStrikerRuns = innings.strikerRuns + input.batterRuns;
        data.nonStrikerBalls = innings.strikerBalls + (legal ? input.legalBallsToAdd : 0);
        data.nonStrikerFours = innings.strikerFours + (input.batterRuns === 4 ? 1 : 0);
        data.nonStrikerSixes = innings.strikerSixes + (input.batterRuns === 6 ? 1 : 0);
      }
    }

    const updated = await prisma.innings.update({ where: { id: innings.id }, data });

    // --- ball history row
    const ballsBowledBefore = innings.legalBalls;
    const ballRow = await prisma.ball.create({
      data: {
        inningsId: innings.id,
        over: Math.floor(ballsBowledBefore / 6),
        ballInOver: (ballsBowledBefore % 6) + 1,
        runs: input.runs,
        batterRuns: input.batterRuns,
        extraType: (input.extraType as never) ?? null,
        isLegal: legal,
        isWicket,
        wicketKind: (input.wicketKind as never) ?? null,
        batterOutId: input.batterOutId ?? null,
        strikerId: innings.strikerId,
        nonStrikerId: innings.nonStrikerId,
        bowlerId: innings.bowlerId,
        label: ballLabel({ runs: input.runs, batterRuns: input.batterRuns, isWicket, extraType: input.extraType }),
        teamRuns: updated.runs,
        teamWickets: updated.wickets,
      },
    });

    // --- end of over: maiden credit, bowler change, fresh spell figures
    if (overCompletes && updated.wickets < 10) {
      const completedOver = Math.floor((newLegalBalls - 1) / 6);
      const overBalls = await prisma.ball.findMany({
        where: { inningsId: innings.id, over: completedOver },
        select: { runs: true, extraType: true },
      });
      // Byes / leg-byes / penalties are not charged to the bowler.
      const conceded = overBalls.reduce(
        (sum, b) => sum + (['LB', 'B', 'P'].includes(b.extraType ?? '') ? 0 : b.runs),
        0,
      );
      await prisma.innings.update({
        where: { id: innings.id },
        data: {
          bowlerMaidens: innings.bowlerMaidens + (conceded === 0 ? 1 : 0),
          bowlerId: await nextBowler(innings, loaded, completedOver),
          bowlerRuns: 0,
          bowlerBalls: 0,
          bowlerWickets: 0,
        },
      });
    }

    // --- innings completion checks
    const maxBalls = formatMaxOvers(loaded.match.format, loaded.match.oversPerInnings);
    const allOut = updated.wickets >= 10;
    const oversDone = !!maxBalls && updated.legalBalls >= maxBalls;
    const chased = updated.target != null && updated.runs >= updated.target;

    // --- events (only from real data)
    const events: MatchEvent[] = [];
    const addEvent = (type: MatchEventType, headline: string, facts: MatchEvent['facts'], priority: number) => {
      events.push({
        id: uid(),
        type,
        matchId,
        headline,
        facts,
        priority,
        createdAt: new Date().toISOString(),
      });
    };

    const strikerName = innings.strikerId ? loaded.players.get(innings.strikerId)?.name ?? 'Batter' : 'Batter';
    const bowlerName = innings.bowlerId ? loaded.players.get(innings.bowlerId)?.name ?? 'Bowler' : 'Bowler';

    if (isWicket) {
      const outName = input.batterOutId
        ? loaded.players.get(input.batterOutId)?.name ?? strikerName
        : strikerName;
      addEvent(
        'WICKET',
        `${bowlerName} to ${outName} - OUT${input.wicketKind ? ` (${input.wicketKind})` : ''}`,
        {
          isWicket: true,
          dismissal: (input.wicketKind as never) ?? null,
          batterOut: outName,
          bowler: bowlerName,
          teamRuns: updated.runs,
          teamWickets: updated.wickets,
          overs: ballsToOvers(updated.legalBalls),
        },
        100,
      );
    } else if (input.batterRuns === 6) {
      addEvent(
        'SIX',
        `${bowlerName} to ${strikerName} - SIX!`,
        { isSix: true, runs: 6, batter: strikerName, bowler: bowlerName, teamRuns: updated.runs, overs: ballsToOvers(updated.legalBalls) },
        90,
      );
    } else if (input.batterRuns === 4) {
      addEvent(
        'FOUR',
        `${bowlerName} to ${strikerName} - FOUR`,
        { isFour: true, runs: 4, batter: strikerName, bowler: bowlerName, teamRuns: updated.runs, overs: ballsToOvers(updated.legalBalls) },
        80,
      );
    } else if (input.runs > 0 || input.extraType) {
      addEvent(
        'BALL',
        `${bowlerName} to ${strikerName} - ${input.runs} run(s)`,
        { runs: input.runs, batter: strikerName, bowler: bowlerName, isExtra: !!input.extraType, extraType: (input.extraType as never) ?? null },
        20,
      );
    }

    // milestones (crossing 50/100 with this delivery)
    for (const milestone of [50, 100] as const) {
      if (before.strikerRuns < milestone && updated.strikerRuns >= milestone) {
        addEvent(
          'MILESTONE',
          `${strikerName} brings up ${milestone === 50 ? 'his fifty' : 'his century'}!`,
          { milestone: milestone === 50 ? 'FIFTY' : 'HUNDRED', batter: strikerName, teamRuns: updated.runs },
          95,
        );
      }
    }
    if (before.bowlerWickets < 5 && updated.bowlerWickets >= 5) {
      addEvent('MILESTONE', `Five-wicket haul for ${bowlerName}!`, { milestone: 'FIVE_WICKETS', bowler: bowlerName }, 95);
    }

    if (overCompletes && !allOut) {
      addEvent(
        'OVER_END',
        `End of over ${Math.floor(newLegalBalls / 6)}: ${updated.runs}/${updated.wickets}`,
        { overs: ballsToOvers(updated.legalBalls), teamRuns: updated.runs, teamWickets: updated.wickets },
        30,
      );
    }

    if (allOut || oversDone || chased) {
      await prisma.innings.update({ where: { id: innings.id }, data: { isCompleted: true } });
      addEvent(
        'INNINGS_END',
        `Innings ${updated.number} complete: ${updated.runs}/${updated.wickets}${chased ? ' - target chased' : ''}`,
        { overs: ballsToOvers(updated.legalBalls), teamRuns: updated.runs, teamWickets: updated.wickets },
        85,
      );
      await prisma.match.update({ where: { id: matchId }, data: { status: 'INNINGS_BREAK' } });
    } else {
      await prisma.match.update({ where: { id: matchId }, data: { status: 'LIVE' } });
    }

    // persist events for the audit trail / replay mode
    if (events.length) {
      await prisma.scoreEvent.createMany({
        data: events.map((e) => ({
          matchId,
          type: e.type as never,
          headline: e.headline.slice(0, 240),
          facts: e.facts as object,
          priority: e.priority,
        })),
      });
    }

    void before;
    void ballRow;

    const snapshot = await getSnapshot(matchId);
    if (!snapshot) throw new ScoreError('Failed to build score snapshot', 500);
    return { snapshot, events };
  });
}

/* ------------------------------------------------------------------ */
/* Public scoring entry points                                         */
/* ------------------------------------------------------------------ */

export async function addBall(matchId: string, dto: BallInput): Promise<CommitResult> {
  const parsed = ballInputSchema.parse(dto);
  const legal = isLegalDelivery(parsed.extraType ?? null);
  const batterRuns =
    parsed.batterRuns ??
    (parsed.extraType === 'WD' || parsed.extraType === 'LB' || parsed.extraType === 'B' || parsed.extraType === 'P'
      ? 0
      : parsed.extraType === 'NB'
        ? Math.max(0, parsed.runs - 1)
        : parsed.runs);
  return commitBall(matchId, {
    runs: parsed.runs,
    batterRuns,
    extraType: parsed.extraType ?? null,
    isWicket: parsed.isWicket,
    wicketKind: parsed.wicketKind ?? null,
    batterOutId: parsed.batterOutId ?? null,
    newBatterId: parsed.newBatterId ?? null,
    legalBallsToAdd: legal ? 1 : 0,
    commentary: parsed.commentary ?? null,
  });
}

/**
 * Declarative sync from an authorised scoring provider (POST /api/match/update).
 * Only ever derived from the data we are given - no invented events.
 */
export async function applyScoreUpdate(matchId: string, dto: ScoreUpdateInput): Promise<CommitResult> {
  const loaded = await load(matchId);
  let innings = loaded.innings;

  if (!innings) {
    // Auto-start if the provider pushes data before the operator starts the match.
    innings = (await startMatch(matchId, { battingTeamId: resolveBattingTeam(loaded, dto) ?? undefined })) as Innings;
  } else if (innings.isCompleted && dto.innings && dto.innings > innings.number) {
    innings = (await startNextInnings(matchId, { target: dto.target ?? undefined })) as Innings;
  }

  const targetOvers = dto.overs !== undefined ? oversToBalls(Number(dto.overs)) : innings.legalBalls;
  if (targetOvers < innings.legalBalls) throw new ScoreError('Overs cannot go backwards', 400);
  if (dto.runs !== undefined && dto.runs < innings.runs) throw new ScoreError('Runs cannot go backwards', 400);
  if (dto.wickets !== undefined && dto.wickets < innings.wickets) {
    throw new ScoreError('Wickets cannot go backwards', 400);
  }

  // Resolve named players (auto-creating unknown squad members so live feeds never stall)
  const battingTeamId = innings.battingTeamId;
  const bowlingTeamId = innings.bowlingTeamId;
  const strikerId = dto.striker ? await resolvePlayer(battingTeamId, dto.striker, 'BAT') : innings.strikerId;
  const nonStrikerId = dto.non_striker
    ? await resolvePlayer(battingTeamId, dto.non_striker, 'BAT')
    : innings.nonStrikerId;
  const bowlerId = dto.bowler ? await resolvePlayer(bowlingTeamId, dto.bowler, 'BOWL') : innings.bowlerId;

  await prisma.innings.update({
    where: { id: innings.id },
    data: {
      strikerId,
      nonStrikerId,
      bowlerId,
      ...(dto.striker_runs !== undefined ? { strikerRuns: dto.striker_runs } : {}),
      ...(dto.striker_balls !== undefined ? { strikerBalls: dto.striker_balls } : {}),
      ...(dto.bowler_wickets !== undefined ? { bowlerWickets: dto.bowler_wickets } : {}),
      ...(dto.bowler_runs !== undefined ? { bowlerRuns: dto.bowler_runs } : {}),
      ...(dto.target !== null && dto.target !== undefined ? { target: dto.target } : {}),
    },
  });

  const deltaRuns = dto.runs !== undefined ? dto.runs - innings.runs : 0;
  const deltaWickets = dto.wickets !== undefined ? dto.wickets - innings.wickets : 0;
  const deltaBalls = targetOvers - innings.legalBalls;

  if (deltaRuns === 0 && deltaWickets === 0 && deltaBalls === 0) {
    const snapshot = await getSnapshot(matchId);
    if (!snapshot) throw new ScoreError('Failed to build score snapshot', 500);
    return { snapshot, events: [] };
  }

  // Collapse the delta into a single delivery: keeps history intact and drives
  // boundaries/wickets/milestones exactly like a manual ball.
  const extraType = deltaBalls === 0 ? 'WD' : null;
  const isWicket = deltaWickets > 0;
  const batterRuns = isWicket ? 0 : Math.max(0, deltaRuns - (deltaBalls === 0 ? 1 : 0));

  return commitBall(matchId, {
    runs: deltaRuns,
    batterRuns,
    extraType,
    isWicket,
    wicketKind: isWicket ? 'OTHER' : null,
    batterOutId: null,
    newBatterId: strikerId,
    legalBallsToAdd: deltaBalls,
  });
}

/** Next undismissed batter from the batting team, excluding the current non-striker. */
async function nextBatter(innings: Innings, loaded: LoadedMatch, dismissedId: string | null): Promise<string | null> {
  const dismissed = await prisma.ball.findMany({
    where: { inningsId: innings.id, isWicket: true },
    select: { batterOutId: true },
  });
  const out = new Set(dismissed.map((b) => b.batterOutId).filter(Boolean) as string[]);
  if (dismissedId) out.add(dismissedId);

  const candidates = [...loaded.players.values()].filter(
    (p) =>
      p.teamId === innings.battingTeamId &&
      !out.has(p.id) &&
      p.id !== innings.nonStrikerId &&
      p.id !== innings.strikerId,
  );
  if (candidates.length) return candidates[0]!.id;

  // Squad exhausted or unknown: fall back to anyone not currently at the crease.
  const fallback = [...loaded.players.values()].find(
    (p) => p.teamId === innings.battingTeamId && p.id !== innings.nonStrikerId,
  );
  return fallback?.id ?? null;
}

function resolveBattingTeam(loaded: LoadedMatch, dto: ScoreUpdateInput): string | null {
  const name = (dto.team ?? dto.batting_team ?? '').toLowerCase();
  if (!name) return null;
  if (loaded.match.teamA.name.toLowerCase() === name || loaded.match.teamA.shortName.toLowerCase() === name) {
    return loaded.match.teamAId;
  }
  if (loaded.match.teamB.name.toLowerCase() === name || loaded.match.teamB.shortName.toLowerCase() === name) {
    return loaded.match.teamBId;
  }
  return null;
}

async function resolvePlayer(teamId: string, name: string, role: 'BAT' | 'BOWL' | 'AR' | 'WK'): Promise<string> {
  const existing = await prisma.player.findFirst({ where: { teamId, name: { equals: name, mode: 'insensitive' } } });
  if (existing) return existing.id;
  const created = await prisma.player.create({ data: { teamId, name, role } });
  logger.info('backend', `Auto-registered player from scoring feed: ${name}`, { playerId: created.id });
  return created.id;
}

/**
 * Next bowler for the following over: never the bowler who just bowled, and
 * never the bowler of the previous over (no consecutive overs).
 */
async function nextBowler(innings: Innings, loaded: LoadedMatch, completedOver: number): Promise<string | null> {
  const squad = [...loaded.players.values()].filter((p) => p.teamId === innings.bowlingTeamId);
  if (!squad.length) return innings.bowlerId;
  const specialists = squad.filter((p) => p.role === 'BOWL' || p.role === 'AR');
  const pool = specialists.length >= 2 ? specialists : squad;

  const previous = await prisma.ball.findFirst({
    where: { inningsId: innings.id, over: completedOver - 1 },
    select: { bowlerId: true },
  });
  const excluded = new Set([innings.bowlerId, previous?.bowlerId].filter(Boolean) as string[]);
  const eligible = pool.filter((p) => !excluded.has(p.id));
  const rotation = eligible.length ? eligible : pool.filter((p) => p.id !== innings.bowlerId);

  const currentIndex = pool.findIndex((p) => p.id === innings.bowlerId);
  for (let step = 1; step <= pool.length; step++) {
    const candidate = pool[(currentIndex + step) % pool.length]!;
    if (rotation.some((p) => p.id === candidate.id)) return candidate.id;
  }
  return innings.bowlerId;
}

/**
 * Squad order is insertion order (the order the operator typed the XI in), so
 * the first two batters are the openers and the first frontline bowler opens
 * the bowling. Operators can always override these from the dashboard.
 */
function pickOpeners(loaded: LoadedMatch, battingTeamId: string): { strikerId: string | null; nonStrikerId: string | null } {
  const squad = [...loaded.players.values()].filter((p) => p.teamId === battingTeamId);
  const batters = squad.filter((p) => p.role !== 'BOWL');
  const order = batters.length >= 2 ? batters : squad;
  return { strikerId: order[0]?.id ?? null, nonStrikerId: order[1]?.id ?? null };
}

function pickBowler(loaded: LoadedMatch, bowlingTeamId: string): string | null {
  const squad = [...loaded.players.values()].filter((p) => p.teamId === bowlingTeamId);
  const bowlers = squad.filter((p) => p.role === 'BOWL' || p.role === 'AR');
  return (bowlers[0] ?? squad[0])?.id ?? null;
}

/** Roll back the last delivery (operator correction). */
export async function undoLastBall(matchId: string) {
  return withMatchLock(matchId, async () => {
    const loaded = await load(matchId);
    const innings = await prisma.innings.findFirst({ where: { matchId }, orderBy: { number: 'desc' } });
    if (!innings) throw new ScoreError('No innings', 409);
    const last = await prisma.ball.findFirst({ where: { inningsId: innings.id }, orderBy: { createdAt: 'desc' } });
    if (!last) throw new ScoreError('No deliveries to undo', 409);

    await prisma.ball.delete({ where: { id: last.id } });
    await prisma.innings.update({
      where: { id: innings.id },
      data: {
        runs: Math.max(0, innings.runs - last.runs),
        wickets: Math.max(0, innings.wickets - (last.isWicket ? 1 : 0)),
        legalBalls: Math.max(0, innings.legalBalls - (last.isLegal ? 1 : 0)),
        strikerRuns: Math.max(0, innings.strikerRuns - last.batterRuns),
        strikerBalls: Math.max(0, innings.strikerBalls - (last.isLegal ? 1 : 0)),
        strikerFours: Math.max(0, innings.strikerFours - (last.batterRuns === 4 ? 1 : 0)),
        strikerSixes: Math.max(0, innings.strikerSixes - (last.batterRuns === 6 ? 1 : 0)),
        bowlerRuns: Math.max(0, innings.bowlerRuns - last.runs),
        bowlerBalls: Math.max(0, innings.bowlerBalls - (last.isLegal ? 1 : 0)),
        bowlerWickets: Math.max(0, innings.bowlerWickets - (last.isWicket ? 1 : 0)),
        isCompleted: false,
      },
    });
    logger.info('backend', 'Last delivery undone', { matchId });
    const snapshot = await getSnapshot(matchId);
    if (!snapshot) throw new ScoreError('Failed to build score snapshot', 500);
    return { snapshot, events: [] as MatchEvent[] };
  });
}

export async function setBatter(
  matchId: string,
  which: 'striker' | 'nonStriker' | 'bowler',
  playerId: string | null,
) {
  return withMatchLock(matchId, async () => {
    const loaded = await load(matchId);
    const innings = currentInnings(loaded);
    const field = which === 'striker' ? 'strikerId' : which === 'nonStriker' ? 'nonStrikerId' : 'bowlerId';
    await prisma.innings.update({ where: { id: innings.id }, data: { [field]: playerId } });
    const snapshot = await getSnapshot(matchId);
    if (!snapshot) throw new ScoreError('Failed to build score snapshot', 500);
    return { snapshot, events: [] as MatchEvent[] };
  });
}

/* ------------------------------------------------------------------ */
/* Snapshot building (what graphics + commentary consume)              */
/* ------------------------------------------------------------------ */

function batterSnapshot(p: Player | undefined, innings: Innings, onStrike: boolean): BatterSnapshot | null {
  if (!p) return null;
  const runs = onStrike ? innings.strikerRuns : innings.nonStrikerRuns;
  const balls = onStrike ? innings.strikerBalls : innings.nonStrikerBalls;
  const fours = onStrike ? innings.strikerFours : innings.nonStrikerFours;
  const sixes = onStrike ? innings.strikerSixes : innings.nonStrikerSixes;
  return {
    id: p.id,
    name: p.name,
    runs,
    balls,
    fours,
    sixes,
    strikeRate: strikeRate(runs, balls),
    onStrike,
  };
}

function bowlerSnapshot(p: Player | undefined, innings: Innings): BowlerSnapshot | null {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    overs: ballsToOvers(innings.bowlerBalls),
    maidens: innings.bowlerMaidens,
    runs: innings.bowlerRuns,
    wickets: innings.bowlerWickets,
    economy: economy(innings.bowlerRuns, innings.bowlerBalls),
  };
}

export async function getSnapshot(matchId: string): Promise<ScoreSnapshot | null> {
  const loaded = await load(matchId);
  const { match, innings, players } = loaded;
  if (!innings) return null;

  const [recent, allInnings] = await Promise.all([
    prisma.ball.findMany({ where: { inningsId: innings.id }, orderBy: { createdAt: 'desc' }, take: 24 }),
    prisma.innings.findMany({ where: { matchId }, orderBy: { number: 'asc' } }),
  ]);

  const recentBalls: BallSnapshot[] = recent
    .slice()
    .reverse()
    .map((b) => ({
      id: b.id,
      over: b.over,
      ballInOver: b.ballInOver,
      label: b.label,
      runs: b.runs,
      batterRuns: b.batterRuns,
      isExtra: !!b.extraType,
      extraType: (b.extraType as BallSnapshot['extraType']) ?? null,
      isWicket: b.isWicket,
      isFour: b.batterRuns === 4,
      isSix: b.batterRuns === 6,
      isLegal: b.isLegal,
      commentary: null,
      createdAt: b.createdAt.toISOString(),
    }));

  const maxBalls = formatMaxOvers(match.format, match.oversPerInnings);
  const target = innings.target ?? (innings.number > 1 ? (allInnings[0]?.runs ?? 0) + 1 : null);
  const rr = requiredRunRate(target ?? 0, innings.runs, innings.legalBalls, maxBalls ?? 0);

  return {
    matchId: match.id,
    inningsId: innings.id,
    inningsNumber: innings.number,
    status: match.status as ScoreSnapshot['status'],
    format: match.format as ScoreSnapshot['format'],
    title: match.title,
    tournament: match.tournament,
    venue: match.venue,
    battingTeam: toTeamRef(teamOf(match, innings.battingTeamId)),
    bowlingTeam: toTeamRef(teamOf(match, innings.bowlingTeamId)),
    runs: innings.runs,
    wickets: innings.wickets,
    overs: ballsToOvers(innings.legalBalls),
    legalBalls: innings.legalBalls,
    target,
    maxOvers: maxBalls ? maxBalls / 6 : null,
    runRate: runRate(innings.runs, innings.legalBalls),
    requiredRunRate: rr,
    runsRequired: target ? runsRequired(target, innings.runs) : null,
    ballsRemaining: maxBalls ? Math.max(0, maxBalls - innings.legalBalls) : null,
    projectedScore: projectedScore(innings.runs, innings.legalBalls, maxBalls ?? 0),
    striker: batterSnapshot(innings.strikerId ? players.get(innings.strikerId) : undefined, innings, true),
    nonStriker: batterSnapshot(innings.nonStrikerId ? players.get(innings.nonStrikerId) : undefined, innings, false),
    bowler: bowlerSnapshot(innings.bowlerId ? players.get(innings.bowlerId) : undefined, innings),
    partnership: { runs: innings.partnershipRuns, balls: innings.partnershipBalls },
    extras: {
      wides: innings.wides,
      noBalls: innings.noBalls,
      byes: innings.byes,
      legByes: innings.legByes,
      penalties: innings.penalties,
      total: innings.wides + innings.noBalls + innings.byes + innings.legByes + innings.penalties,
    },
    freeHit: innings.freeHit,
    recentBalls,
    version: Number(`${innings.legalBalls}${innings.runs}${innings.wickets}`) + innings.number * 1_000_000,
    updatedAt: new Date().toISOString(),
  };
}

function toTeamRef(team: Team) {
  return {
    id: team.id,
    name: team.name,
    shortName: team.shortName,
    logoUrl: team.logoUrl,
    primaryColor: team.primaryColor,
    secondaryColor: team.secondaryColor,
  };
}

export async function getLiveMatchId(): Promise<string | null> {
  const m = await prisma.match.findFirst({
    where: { status: { in: ['LIVE', 'INNINGS_BREAK', 'PAUSED'] } },
    orderBy: { updatedAt: 'desc' },
  });
  if (m) return m.id;
  const latest = await prisma.match.findFirst({ orderBy: { updatedAt: 'desc' } });
  return latest?.id ?? null;
}
