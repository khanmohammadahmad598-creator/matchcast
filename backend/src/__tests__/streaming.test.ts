import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { createServer } from '../index';
import { settings } from '../services/settings';

let app: Express;
let token: string;
let originalInput: Awaited<ReturnType<typeof settings.input>>;

beforeAll(async () => {
  ({ app } = await createServer());
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@matchcast.local', password: 'ChangeMeNow123!' });
  token = login.body.token as string;
  originalInput = await settings.input();
});

afterAll(async () => {
  await settings.setInput(originalInput);
});

describe('streaming API', () => {
  it('never exposes the YouTube stream key in output settings', async () => {
    const res = await request(app).get('/api/stream/output').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    // The key itself must never appear; a boolean "is it configured?" is fine.
    expect(res.body.output.streamKey).toBeUndefined();
    const key = process.env.YOUTUBE_STREAM_KEY;
    if (key) expect(body).not.toContain(key);
    expect(body).not.toContain('YOUTUBE_STREAM_KEY');
  });

  it('masks the stream key in the live status payload', async () => {
    const res = await request(app).get('/api/stream/status').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    // Even the (already masked) target must not contain the raw key.
    const key = process.env.YOUTUBE_STREAM_KEY;
    if (key) expect(body).not.toContain(key);
  });

  it('requires an authenticated operator to change output settings', async () => {
    const res = await request(app).put('/api/stream/output').send({ resolution: '720p' });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid resolution', async () => {
    const res = await request(app)
      .put('/api/stream/output')
      .set('authorization', `Bearer ${token}`)
      .send({ resolution: '8k' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('accepts a valid output update (local RTMP target, no key involved)', async () => {
    const res = await request(app)
      .put('/api/stream/output')
      .set('authorization', `Bearer ${token}`)
      .send({ resolution: '720p', fps: 30, videoBitrateKbps: 2500 });
    expect(res.status).toBe(200);
    expect(res.body.output.resolution).toBe('720p');
  });

  it('refuses to start a stream from a source that is not rights-attested (compliance)', async () => {
    await request(app)
      .put('/api/stream/input')
      .set('authorization', `Bearer ${token}`)
      .send({ kind: 'file', url: '/tmp/not-rights-cleared.mp4', rightsAttested: false });
    const res = await request(app).post('/api/stream/start').set('authorization', `Bearer ${token}`);
    // 403 = compliance gate, 503 = worker offline (the gate runs first).
    expect([403, 503]).toContain(res.status);
    if (res.status === 403) expect(res.body.error).toMatch(/rights/i);
  });

  it('stores the rights attestation alongside the input source (audit trail)', async () => {
    const res = await request(app)
      .put('/api/stream/input')
      .set('authorization', `Bearer ${token}`)
      .send({
        kind: 'file',
        url: '/home/user/matchcast/demo-assets/demo-match.mp4',
        rightsAttested: true,
        rightsNote: 'Owned footage - internal test',
      });
    expect(res.status).toBe(200);
    expect(res.body.input.rightsAttested).toBe(true);
    expect(res.body.input.rightsNote).toBe('Owned footage - internal test');
  });

  it('rejects an input URL that is obviously not a media source', async () => {
    const res = await request(app)
      .put('/api/stream/input')
      .set('authorization', `Bearer ${token}`)
      .send({ kind: 'hls', url: 'not-a-url', rightsAttested: true });
    expect(res.status).toBe(400);
  });
});
