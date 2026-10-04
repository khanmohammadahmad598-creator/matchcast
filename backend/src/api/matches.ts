import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { getMatchDetail, listMatches, createMatch, updateMatch } from '../services/matchService';
import { createMatchSchema, updateMatchSchema } from '@matchcast/shared';

export const matchesRouter: Router = Router();

matchesRouter.use(requireAuth);

matchesRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ matches: await listMatches() });
  } catch (err) {
    next(err);
  }
});

matchesRouter.post('/', requireRole('ADMIN', 'OPERATOR'), validate(createMatchSchema), async (req, res, next) => {
  try {
    const match = await createMatch(req.body);
    res.status(201).json({ match });
  } catch (err) {
    next(err);
  }
});

matchesRouter.get('/:id', async (req, res, next) => {
  try {
    res.json({ match: await getMatchDetail(req.params.id) });
  } catch (err) {
    next(err);
  }
});

matchesRouter.patch('/:id', requireRole('ADMIN', 'OPERATOR'), validate(updateMatchSchema), async (req, res, next) => {
  try {
    res.json({ match: await updateMatch(req.params.id, req.body) });
  } catch (err) {
    next(err);
  }
});

/** Squad lists for the match-control UI. */
matchesRouter.get('/:id/players', async (req, res, next) => {
  try {
    const match = await getMatchDetail(req.params.id);
    res.json({
      teamA: { id: match.teamA.id, name: match.teamA.name, players: match.teamA.players },
      teamB: { id: match.teamB.id, name: match.teamB.name, players: match.teamB.players },
    });
  } catch (err) {
    next(err);
  }
});

/** Recent deliveries (audit + commentary history). */
matchesRouter.get('/:id/balls', async (req, res, next) => {
  try {
    const match = await getMatchDetail(req.params.id);
    const innings = match.innings[match.innings.length - 1];
    if (!innings) return void res.json({ balls: [] });
    const balls = await prisma.ball.findMany({
      where: { inningsId: innings.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ balls: balls.reverse() });
  } catch (err) {
    next(err);
  }
});
