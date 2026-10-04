import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { createServer } from '../index';
import { prisma } from '../db/prisma';
import { config } from '../core/config';

let app: Express;
let token: string;
const SCORING_KEY = config.SCORING_API_KEY ?? 'dev-local-scoring-api-key';
let matchId: string;
const createdMatchIds: string[] = [];

const TEAM = (name: string, short: string) => ({
  name,
  shortName: short,
  players: [
    { name: 'Batter One', role: 'BAT' as const },
    { name: 'Batter Two', role: 'BAT' as const },
    { name: 'Batter Three', role: 'BAT' as const },
    { name: 'Bowler One', role: 'BOWL' as const },
    { name: 'Bowler Two', role: 'BOWL' as const },
  ],
});

beforeAll(async () => {
  ({ app } = await createServer());
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@matchcast.local', password: 'ChangeMeNow123!' });
  token = login.body.token as string;

  const created = await request(app)
    .post('/api/matches')
    .set('authorization', `Bearer ${token}`)
    .send({
      title: 'Vitest XI vs Backend XI',
      tournament: 'Test Series',
      venue: 'Kanpur',
      format: 'T20',
      oversPerInnings: 20,
      teamA: TEAM('Vitest XI', 'VIT'),
      teamB: TEAM('Backend XI', 'BE'),
    });
  expect(created.status).toBe(201);
  matchId = created.body.match.id as string;
  createdMatchIds.push(matchId);
});

afterAll(async () => {
  // Clean up the fixture match (cascades to innings / balls / events).
  await prisma.match.deleteMany({ where: { id: { in: createdMatchIds } } });
});

const state = async () => {
  const res = await request(app).get(`/api/match/${matchId}/state`);
  expect(res.status).toBe(200);
  return res.body.snapshot;
};

const ball = async (runs: number, extra?: Record<string, unknown>) => {
  const res = await request(app)
    .post(`/api/match/${matchId}/ball`)
    .set('authorization', `Bearer ${token}`)
    .send({ runs, ...extra });
  expect([200, 201]).toContain(res.status);
  return res;
};

describe('scoring engine', () => {
  it('starts a match and puts two batters at the crease', async () => {
    const res = await request(app)
      .post(`/api/match/${matchId}/start`)
      .set('authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    const s = await state();
    expect(s.status).toBe('LIVE');
    expect(s.runs).toBe(0);
    expect(s.wickets).toBe(0);
    expect(s.striker?.name).toBeTruthy();
    expect(s.nonStriker?.name).toBeTruthy();
    expect(s.bowler?.name).toBeTruthy();
  });

  it('records runs, balls faced and the recent-balls timeline', async () => {
    await ball(4);
    await ball(6);
    await ball(1);
    const s = await state();
    expect(s.runs).toBe(11);
    expect(s.legalBalls).toBe(3);
    expect(s.overs).toBe(0.3);
    expect(s.recentBalls.map((b: { label: string }) => b.label)).toEqual(['4', '6', '1']);
    // The single rotated the strike, so the new striker is the previous non-striker.
    expect(s.striker.id).toBeTruthy();
    expect(s.nonStriker.id).toBeTruthy();
    expect(s.striker.id).not.toBe(s.nonStriker.id);
  });

  it('rotates the strike on odd runs only', async () => {
    const before = await state();
    await ball(1);
    const after = await state();
    expect(after.striker.id).not.toBe(before.striker.id);
    await ball(2);
    const afterTwo = await state();
    expect(afterTwo.striker.id).toBe(after.striker.id);
  });

  it('counts wides as team runs but not as legal deliveries', async () => {
    const before = await state();
    await ball(1, { extraType: 'WD' });
    const after = await state();
    expect(after.runs).toBe(before.runs + 1);
    expect(after.legalBalls).toBe(before.legalBalls);
    expect(after.recentBalls.at(-1).label).toContain('wd');
  });

  it('completes an over after six legal balls and changes the bowler', async () => {
    const before = await state();
    const ballsToOver = 6 - (before.legalBalls % 6);
    for (let i = 0; i < ballsToOver; i++) await ball(0);
    const after = await state();
    expect(Math.floor(after.legalBalls / 6)).toBeGreaterThan(Math.floor(before.legalBalls / 6));
    expect(after.bowler.id).not.toBe(before.bowler.id);
  });

  it('records a wicket and brings in the next batter', async () => {
    const before = await state();
    const res = await request(app)
      .post(`/api/match/${matchId}/wicket`)
      .set('authorization', `Bearer ${token}`)
      .send({ wicketKind: 'CAUGHT' });
    expect(res.status).toBe(200);
    const after = await state();
    expect(after.wickets).toBe(before.wickets + 1);
    expect(after.striker.id).not.toBe(before.striker.id);
    expect(after.recentBalls.at(-1).label).toBe('W');
  });

  it('rejects impossible deliveries (validation)', async () => {
    const res = await request(app)
      .post(`/api/match/${matchId}/ball`)
      .set('authorization', `Bearer ${token}`)
      .send({ runs: 99 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    const badType = await request(app)
      .post(`/api/match/${matchId}/ball`)
      .set('authorization', `Bearer ${token}`)
      .send({ runs: 'four' });
    expect(badType.status).toBe(400);
  });

  it('requires operator/admin rights to score', async () => {
    const res = await request(app).post(`/api/match/${matchId}/ball`).send({ runs: 1 });
    expect(res.status).toBe(401);
  });
});

describe('scoring provider API (POST /api/match/update)', () => {
  it('accepts an authorised provider push', async () => {
    const res = await request(app)
      .post('/api/match/update')
      .set('x-scoring-api-key', SCORING_KEY)
      .send({ runs: 42, wickets: 2, overs: '5.3', striker: 'Batter Two', bowler: 'Bowler Two' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const s = await state();
    expect(s.runs).toBe(42);
    expect(s.wickets).toBe(2);
    expect(s.overs).toBe(5.3);
  });

  it('rejects an unauthorised provider push', async () => {
    const res = await request(app)
      .post('/api/match/update')
      .set('x-scoring-api-key', 'wrong-key')
      .send({ runs: 1 });
    expect([401, 403]).toContain(res.status);
  });

  it('rejects a malformed provider push', async () => {
    const res = await request(app)
      .post('/api/match/update')
      .set('x-scoring-api-key', SCORING_KEY)
      .send({ overs: 'not-decimal-overs' });
    expect(res.status).toBe(400);
  });
});
