import Redis from 'ioredis';
import { config } from './config';
import { logger } from './logger';

/**
 * Redis is optional. When it is unavailable (local demo, single-node dev) the
 * platform falls back to in-process state - it never blocks a live broadcast.
 */
let client: Redis | null = null;
let available = false;

export function initRedis(): Redis | null {
  if (!config.REDIS_ENABLED) {
    logger.info('backend', 'Redis disabled by configuration (REDIS_ENABLED=false)');
    return null;
  }
  client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(10_000, 500 * times),
  });
  client.on('error', (err: Error & { code?: string }) => {
    if (available) logger.warn('backend', 'Redis error', { error: err.message });
    available = false;
  });
  client.on('ready', () => {
    available = true;
    logger.info('backend', 'Connected to Redis');
  });
  client.connect().catch((err: Error) => {
    logger.warn('backend', 'Redis unavailable, running without cache/queues', { error: err.message });
  });
  return client;
}

export function redis(): Redis | null {
  return client;
}

export function isRedisAvailable(): boolean {
  return available && !!client;
}

export async function redisGet(key: string): Promise<string | null> {
  if (!isRedisAvailable()) return null;
  try {
    return await client!.get(key);
  } catch {
    return null;
  }
}

export async function redisSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  if (!isRedisAvailable()) return;
  try {
    if (ttlSeconds) await client!.set(key, value, 'EX', ttlSeconds);
    else await client!.set(key, value);
  } catch {
    /* non fatal */
  }
}
