import { describe, it, expect, afterEach, vi } from 'vitest';

const originalKey = process.env.YOUTUBE_STREAM_KEY;
const originalUrl = process.env.YOUTUBE_RTMP_URL;

afterEach(() => {
  process.env.YOUTUBE_STREAM_KEY = originalKey ?? '';
  process.env.YOUTUBE_RTMP_URL = originalUrl ?? '';
  vi.resetModules();
});

/** Re-imports the config module so the new environment is parsed. */
async function withEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  return import('../config');
}

describe('YouTube RTMP target resolution', () => {
  it('builds the full target from URL + key when a key is configured', async () => {
    const { rtmpTarget } = await withEnv({
      YOUTUBE_RTMP_URL: 'rtmps://a.rtmps.youtube.com/live2',
      YOUTUBE_STREAM_KEY: 'abcd-efgh-ijkl-mnop',
    });
    const { full, key, url } = rtmpTarget();
    expect(key).toBe('abcd-efgh-ijkl-mnop');
    expect(url).toBe('rtmps://a.rtmps.youtube.com/live2');
    expect(full).toBe('rtmps://a.rtmps.youtube.com/live2/abcd-efgh-ijkl-mnop');
  });

  it('never lets the key leak through maskTarget()', async () => {
    const { maskTarget } = await withEnv({
      YOUTUBE_RTMP_URL: 'rtmps://a.rtmps.youtube.com/live2',
      YOUTUBE_STREAM_KEY: 'abcd-efgh-ijkl-mnop',
    });
    const masked = maskTarget();
    expect(masked).not.toContain('abcd-efgh-ijkl-mnop');
    expect(masked).toContain('***');
  });

  it('reports a missing key instead of throwing (worker refuses to go live)', async () => {
    const { rtmpTarget } = await withEnv({ YOUTUBE_STREAM_KEY: undefined });
    const { key, full } = rtmpTarget();
    expect(key).toBe('');
    expect(full).not.toContain('undefined');
  });

  it('defaults to an rtmps:// ingest endpoint', async () => {
    const { rtmpTarget } = await withEnv({ YOUTUBE_RTMP_URL: undefined });
    expect(rtmpTarget().url).toMatch(/^rtmps?:\/\//);
  });

  it('redacts keys embedded in arbitrary log lines', async () => {
    const { redactStreamKey } = await withEnv({
      YOUTUBE_RTMP_URL: 'rtmps://a.rtmps.youtube.com/live2',
      YOUTUBE_STREAM_KEY: 'abcd-efgh-ijkl-mnop',
    });
    const line = 'spawned ffmpeg -f flv rtmps://a.rtmps.youtube.com/live2/abcd-efgh-ijkl-mnop';
    expect(redactStreamKey(line)).not.toContain('abcd-efgh-ijkl-mnop');
    // Unknown rtmp keys are masked too (defence in depth).
    expect(redactStreamKey('rtmp://host/live/someotherkey123')).not.toContain('someotherkey123');
  });
});
