import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth, requireRole, requireScoringAccess } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { realtime } from '../realtime/io';
import {
  addBall,
  applyScoreUpdate,
  getLiveMatchId,
  getSnapshot,
  setBatter,
  startMatch,
  startNextInnings,
  undoLastBall,
} from '../services/matchService';
import { ballInputSchema, manualEventSchema, scoreUpdateSchema, uid } from '@matchcast/shared';

export const scoringRouter: Router = Router();

/** Every scoring write broadcasts the new snapshot to dashboards, graphics and commentary. */
async function broadcast(matchId: string, events: unknown[]) {
  const snapshot = await getSnapshot(matchId);
  if (snapshot) realtime.score(snapshot);
  for (const e of events ?? []) realtime.matchEvent(e);
  return snapshot;
}

/**
 * POST /api/match/update
 * Contract for an authorised live-scoring provider (or the dashboard).
 * Writes require an operator session OR the X-Scoring-Api-Key header.
 */
scoringRouter.post('/match/update', requireScoringAccess, validate(scoreUpdateSchema), async (req, res, next) => {
  try {
    const matchId = (req.body as { matchId?: string }).matchId ?? (await getLiveMatchId());
    if (!matchId) return void res.status(404).json({ error: 'No active match. Create/start a match first.' });
    const { snapshot, events } = await applyScoreUpdate(matchId, req.body);
    await broadcast(matchId, events);
    res.json({ ok: true, matchId, snapshot, events });
  } catch (err) {
    next(err);
  }
});

/** Current score snapshot (polling fallback + first paint for clients). */
scoringRouter.get('/match/state', async (req, res, next) => {
  try {
    const matchId = (req.query.matchId as string | undefined) ?? (await getLiveMatchId());
    if (!matchId) return void res.json({ snapshot: null });
    res.json({ snapshot: await getSnapshot(matchId) });
  } catch (err) {
    next(err);
  }
});

scoringRouter.get('/match/:id/state', async (req, res, next) => {
  try {
    res.json({ snapshot: await getSnapshot(req.params.id) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Operator controls (JWT required)                                    */
/* ------------------------------------------------------------------ */

scoringRouter.post('/match/:id/start', requireAuth, requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    await startMatch(req.params.id, {
      battingTeamId: body.battingTeamId,
      strikerId: body.strikerId,
      nonStrikerId: body.nonStrikerId,
      bowlerId: body.bowlerId,
    });
    const snapshot = await broadcast(req.params.id, []);
    res.json({ ok: true, snapshot });
  } catch (err) {
    next(err);
  }
});

scoringRouter.post('/match/:id/innings', requireAuth, requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    await startNextInnings(req.params.id, {
      strikerId: body.strikerId,
      nonStrikerId: body.nonStrikerId,
      bowlerId: body.bowlerId,
      target: body.target,
    });
    const snapshot = await broadcast(req.params.id, []);
    res.json({ ok: true, snapshot });
  } catch (err) {
    next(err);
  }
});

scoringRouter.post('/match/:id/ball', requireAuth, requireRole('ADMIN', 'OPERATOR'), validate(ballInputSchema), async (req, res, next) => {
  try {
    const { events } = await addBall(req.params.id, req.body);
    const snapshot = await broadcast(req.params.id, events);
    res.status(201).json({ ok: true, snapshot, events });
  } catch (err) {
    next(err);
  }
});

/** Convenience endpoints: /wicket, /boundary, /extra */
scoringRouter.post('/match/:id/wicket', requireAuth, requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { wicketKind?: string; batterOutId?: string; newBatterId?: string; bowlerId?: string };
    const { events } = await addBall(req.params.id, {
      runs: 0,
      isWicket: true,
      wicketKind: body.wicketKind as never,
      batterOutId: body.batterOutId,
      newBatterId: body.newBatterId,
    });
    const snapshot = await broadcast(req.params.id, events);
    res.json({ ok: true, snapshot, events });
  } catch (err) {
    next(err);
  }
});

scoringRouter.post('/match/:id/boundary', requireAuth, requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const runs = Number((req.body ?? {}).runs ?? 4) === 6 ? 6 : 4;
    const { events } = await addBall(req.params.id, { runs, isWicket: false });
    const snapshot = await broadcast(req.params.id, events);
    res.json({ ok: true, snapshot, events });
  } catch (err) {
    next(err);
  }
});

scoringRouter.post('/match/:id/undo', requireAuth, requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    await undoLastBall(req.params.id);
    const snapshot = await broadcast(req.params.id, []);
    res.json({ ok: true, snapshot });
  } catch (err) {
    next(err);
  }
});

scoringRouter.post('/match/:id/batters', requireAuth, requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { strikerId?: string | null; nonStrikerId?: string | null; bowlerId?: string | null };
    if (body.strikerId !== undefined) await setBatter(req.params.id, 'striker', body.strikerId);
    if (body.nonStrikerId !== undefined) await setBatter(req.params.id, 'nonStriker', body.nonStrikerId);
    if (body.bowlerId !== undefined) await setBatter(req.params.id, 'bowler', body.bowlerId);
    const snapshot = await broadcast(req.params.id, []);
    res.json({ ok: true, snapshot });
  } catch (err) {
    next(err);
  }
});

scoringRouter.post('/match/:id/target', requireAuth, requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const target = Number((req.body ?? {}).target);
    if (!Number.isFinite(target) || target < 0) return void res.status(400).json({ error: 'Invalid target' });
    const snapshot = await getSnapshot(req.params.id);
    if (!snapshot) return void res.status(404).json({ error: 'No innings in progress' });
    await prisma.innings.update({ where: { id: snapshot.inningsId }, data: { target } });
    const next2 = await broadcast(req.params.id, []);
    res.json({ ok: true, snapshot: next2 });
  } catch (err) {
    next(err);
  }
});

/** Manual event injection (e.g. an off-ball incident the operator must call). */
scoringRouter.post('/match/:id/event', requireAuth, requireRole('ADMIN', 'OPERATOR'), validate(manualEventSchema), async (req, res, next) => {
  try {
    const body = req.body as { type: string; headline?: string; facts?: Record<string, unknown> };
    const event = {
      id: uid(),
      type: body.type,
      matchId: req.params.id,
      headline: body.headline ?? body.type,
      facts: body.facts ?? {},
      priority: 80,
      createdAt: new Date().toISOString(),
    };
    await prisma.scoreEvent.create({
      data: {
        matchId: req.params.id,
        type: body.type as never,
        headline: event.headline,
        facts: body.facts as object,
        priority: 80,
      },
    });
    realtime.matchEvent(event);
    res.status(201).json({ ok: true, event });
  } catch (err) {
    next(err);
  }
});
