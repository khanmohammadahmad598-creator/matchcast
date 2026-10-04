import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { createServer } from '../index';
import { signToken } from '../middleware/auth';
import { prisma } from '../db/prisma';
import { config } from '../core/config';

let app: Express;

beforeAll(async () => {
  ({ app } = await createServer());
});

describe('auth', () => {
  it('rejects a wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@matchcast.local', password: 'definitely-wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects malformed payloads with 400 (validation layer)', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('issues a JWT for valid credentials and never returns the password hash', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@matchcast.local', password: 'ChangeMeNow123!' });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.email).toBe('admin@matchcast.local');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('protects admin APIs: no token -> 401', async () => {
    const res = await request(app).get('/api/matches');
    expect(res.status).toBe(401);
  });

  it('rejects a forged/expired token -> 401', async () => {
    const res = await request(app)
      .get('/api/matches')
      .set('authorization', 'Bearer not.a.real.token');
    expect(res.status).toBe(401);
  });

  it('refuses to create users for a non-admin role (RBAC)', async () => {
    const viewer = await prisma.user.create({
      data: {
        email: `viewer-${Date.now()}@matchcast.local`,
        name: 'Viewer',
        role: 'VIEWER',
        passwordHash: 'not-a-login',
      },
    });
    const viewerToken = signToken({ id: viewer.id, email: viewer.email, role: 'VIEWER' });
    const res = await request(app)
      .post('/api/auth/register')
      .set('authorization', `Bearer ${viewerToken}`)
      .send({ email: `nope-${Date.now()}@matchcast.local`, password: 'Str0ngPass!', role: 'OPERATOR' });
    expect(res.status).toBe(403);
    await prisma.user.delete({ where: { id: viewer.id } });
  });

  it('rate limits repeated failed logins', async () => {
    // The limiter allows config.AUTH_RATE_LIMIT_MAX attempts per window; hammer it.
    const attempts = await Promise.all(
      Array.from({ length: config.AUTH_RATE_LIMIT_MAX + 3 }, () =>
        request(app).post('/api/auth/login').send({ email: 'admin@matchcast.local', password: 'bad' }),
      ),
    );
    const limited = attempts.filter((r) => r.status === 429);
    expect(limited.length).toBeGreaterThan(0);
  });
});
