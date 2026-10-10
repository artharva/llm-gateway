import Redis from 'ioredis';
import type { Logger } from '../logger';

/**
 * Commands fail fast instead of queueing while Redis is down, so the gateway
 * can fall back to in-memory state right away rather than hanging requests.
 */
export function createRedis(url: string, logger: Logger): Redis {
  const redis = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 500,
    connectTimeout: 2000,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  let lastLog = 0;
  redis.on('error', (err) => {
    if (Date.now() - lastLog > 10_000) {
      lastLog = Date.now();
      logger.warn({ err: err.message }, 'redis error; using in-memory fallbacks until it recovers');
    }
  });
  return redis;
}

/** Waits for the first connection, but never blocks startup for long. */
export async function waitForRedis(redis: Redis, timeoutMs = 3000): Promise<boolean> {
  if (redis.status === 'ready') return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    redis.once('ready', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
