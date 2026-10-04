import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

import { createServer } from '../index';
import { prisma } from '../db/prisma';
import { config } from '../core/config';
import { realtime } from '../realtime/io';
import {
  EV,
  type GraphicsSettings,
  type MatchEvent,
  type ScoreSnapshot,
  type WorkerCommand,
} from '@matchcast/shared';

/**
 * Realtime (Socket.IO) contract tests - spec §12 and §18.
 *
 * A scoring write must reach every connected dashboard without a page refresh,
 * workers must authenticate with the shared WORKER_TOKEN, and worker commands
 * must be routed to the target worker room only.
 */

let httpServer: HttpServer;
let app: Express;
let url: string;
let token: string;
let matchId: string;

/** Sockets opened by the current test - closed in afterEach so state is clean. */
let active: ClientSocket[] = [];

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

/** Resolves on 'connect', rejects on 'connect_error' instead of hanging. */
function connect(auth?: { token?: string; name?: string }, timeoutMs = 5_000): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, {
      transports: ['websocket'],
      forceNew: true,
      auth: auth as Record<string, unknown> | undefined,
    });
    const timer = setTimeout(() => reject(new Error('socket connect timed out')), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      active.push(socket);
      resolve(socket);
    });
    socket.once('connect_error', (err: Error) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
  });
}

/** Resolves on the first payload of `event` that matches `predicate`. */
function waitFor<T>(
  socket: ClientSocket,
  event: string,
  predicate?: (payload: T) => boolean,
  timeoutMs = 5_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const handler = (payload: T) => {
      if (predicate && !predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeoutMs);
    socket.on(event, handler);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls until `predicate()` holds, or throws once the deadline passes. */
async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error('condition not met within timeout');
}

const post = (path: string, body: Record<string, unknown>) =>
  request(app).post(path).set('authorization', `Bearer ${token}`).send(body);

const state = async () => {
  const res = await request(app).get(`/api/match/${matchId}/state`);
  expect(res.status).toBe(200);
  return res.body.snapshot as ScoreSnapshot;
};

beforeAll(async () => {
  ({ app, httpServer } = await createServer());

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@matchcast.local', password: 'ChangeMeNow123!' });
  token = login.body.token as string;

  const created = await request(app)
    .post('/api/matches')
    .set('authorization', `Bearer ${token}`)
    .send({
      title: 'Realtime XI vs Socket XI',
      tournament: 'Realtime Series',
      venue: 'Kanpur',
      format: 'T20',
      oversPerInnings: 20,
      teamA: TEAM('Realtime XI', 'RT'),
      teamB: TEAM('Socket XI', 'SOCK'),
    });
  expect(created.status).toBe(201);
  matchId = created.body.match.id as string;

  const started = await post(`/api/match/${matchId}/start`, {});
  expect(started.status).toBe(200);
});

beforeEach(() => {
  active = [];
});

afterEach(async () => {
  for (const socket of active) socket.close();
  active = [];
  // Let Socket.IO finish the disconnect so the next test starts from a clean room set.
  await waitUntil(() => !realtime.isWorkerOnline('stream-worker'), 2_000).catch(() => undefined);
});

afterAll(async () => {
  await prisma.match.deleteMany({ where: { id: matchId } });
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe('realtime: score updates (Socket.IO)', () => {
  it('pushes score:update to a dashboard client with no page refresh', async () => {
    const socket = await connect({ token });

    const pending = waitFor<ScoreSnapshot>(socket, EV.SCORE_UPDATE, (s) => s.matchId === matchId);
    const res = await post(`/api/match/${matchId}/ball`, { runs: 4 });
    expect(res.status).toBe(201);

    const snapshot = await pending;
    expect(snapshot.matchId).toBe(matchId);
    expect(snapshot.runs).toBe(4);
    expect(snapshot.recentBalls.at(-1)?.label).toBe('4');
  });

  it('pushes the same update to an anonymous read-only viewer', async () => {
    const before = await state();
    const viewer = await connect(); // no auth -> anonymous, read-only

    const pending = waitFor<ScoreSnapshot>(
      viewer,
      EV.SCORE_UPDATE,
      (s) => s.matchId === matchId && s.runs === before.runs + 2,
    );
    const res = await post(`/api/match/${matchId}/ball`, { runs: 2 });
    expect(res.status).toBe(201);

    const snapshot = await pending;
    expect(snapshot.runs).toBe(before.runs + 2);
    expect(snapshot.legalBalls).toBe(before.legalBalls + 1);
  });

  it('broadcasts match:event (WICKET) derived from the scoring data', async () => {
    const socket = await connect({ token });
    const pending = waitFor<MatchEvent>(
      socket,
      EV.MATCH_EVENT,
      (e) => e.matchId === matchId && e.type === 'WICKET',
    );

    const res = await post(`/api/match/${matchId}/wicket`, { wicketKind: 'CAUGHT' });
    expect(res.status).toBe(200);

    const event = await pending;
    expect(event.type).toBe('WICKET');
    expect(event.facts.isWicket).toBe(true);
    expect(event.headline).toBeTruthy();
  });

  it('broadcasts graphics:update when an operator changes the overlay', async () => {
    const socket = await connect({ token });
    const pending = waitFor<GraphicsSettings>(socket, EV.GRAPHICS_UPDATE, (g) => g.lowerThirdVisible === true);

    const res = await request(app)
      .post('/api/graphics/flash')
      .set('authorization', `Bearer ${token}`)
      .send({ title: 'BREAKING', subtitle: 'Realtime test', ms: 0 });
    expect(res.status).toBe(200);

    const settings = await pending;
    expect(settings.lowerThirdTitle).toBe('BREAKING');
  });
});

describe('realtime: workers and command routing', () => {
  it('accepts a worker authenticated with WORKER_TOKEN and marks it online', async () => {
    const worker = await connect({ token: config.WORKER_TOKEN, name: 'stream-worker' });

    await waitUntil(() => realtime.isWorkerOnline('stream-worker'));
    expect(worker.connected).toBe(true);
    expect(realtime.isWorkerOnline('graphics-worker')).toBe(false);
  });

  it('routes worker:command only to the target worker room', async () => {
    const worker = await connect({ token: config.WORKER_TOKEN, name: 'stream-worker' });
    const dashboard = await connect({ token });
    await waitUntil(() => realtime.isWorkerOnline('stream-worker'));

    let dashboardLeak = false;
    dashboard.on(EV.WORKER_COMMAND, () => {
      dashboardLeak = true;
    });

    const pending = waitFor<WorkerCommand>(worker, EV.WORKER_COMMAND);
    expect(realtime.command('stream-worker', { type: 'output:reconnect' })).toBe(true);
    // No graphics-worker is connected, so that command must not be delivered.
    expect(realtime.command('graphics-worker', { type: 'output:reconnect' })).toBe(false);

    const cmd = await pending;
    expect(cmd.type).toBe('output:reconnect');

    await sleep(100);
    expect(dashboardLeak).toBe(false);
  });

  it('marks a worker offline as soon as its socket drops', async () => {
    const worker = await connect({ token: config.WORKER_TOKEN, name: 'stream-worker' });
    await waitUntil(() => realtime.isWorkerOnline('stream-worker'));

    worker.close();
    await waitUntil(() => !realtime.isWorkerOnline('stream-worker'));
    expect(realtime.isWorkerOnline('stream-worker')).toBe(false);
  });

  it('rejects a forged JWT instead of granting access', async () => {
    await expect(connect({ token: 'not-a-valid-jwt' })).rejects.toThrow(/unauthorized/i);
  });

  it('does not let a dashboard client sneak into a worker room', async () => {
    const socket = await connect({ token });
    socket.emit('subscribe', { rooms: ['worker:stream'] });
    await sleep(150);
    // Worker rooms carry worker-only commands, so a dashboard session must
    // never be able to join one (see the guard in realtime/io.ts).
    expect(realtime.isWorkerOnline('stream-worker')).toBe(false);
    expect(socket.connected).toBe(true);
  });

  it('does not let one worker subscribe to another worker\'s room', async () => {
    const worker = await connect({ token: config.WORKER_TOKEN, name: 'stream-worker' });
    await waitUntil(() => realtime.isWorkerOnline('stream-worker'));

    worker.emit('subscribe', { rooms: ['worker:graphics'] });
    await sleep(150);
    expect(realtime.isWorkerOnline('graphics-worker')).toBe(false);
    expect(realtime.isWorkerOnline('stream-worker')).toBe(true);
  });
});
