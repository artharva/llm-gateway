import type Redis from 'ioredis';
import type { Logger } from '../logger';
import type { Usage } from '../types';

export interface CachedResponse {
  text: string;
  usage: Usage;
  provider: string;
}

export interface CacheOptions {
  ttlSeconds: number;
  logger?: Logger;
  onFallback?: (component: string) => void;
  now?: () => number;
  /** Size of the in-memory cache used when no Redis is configured. */
  maxMemoryEntries?: number;
}

/**
 * Answers in Redis with a TTL. A Redis error counts as a miss: the cache
 * only ever saves money, so it must never fail a request.
 */
export class ResponseCache {
  private readonly memory = new Map<string, { value: CachedResponse; expires: number }>();
  private readonly now: () => number;
  private lastLog = 0;

  constructor(
    private readonly redis: Redis | null,
    private readonly opts: CacheOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  async get(key: string): Promise<CachedResponse | null> {
    if (!this.redis) {
      const hit = this.memory.get(key);
      if (!hit || hit.expires <= this.now()) return null;
      // Refresh recency so the Map's insertion order works as an LRU.
      this.memory.delete(key);
      this.memory.set(key, hit);
      return hit.value;
    }
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as CachedResponse) : null;
    } catch (err) {
      this.failed(err);
      return null;
    }
  }

  async set(key: string, value: CachedResponse): Promise<void> {
    if (!this.redis) {
      if (this.memory.size >= (this.opts.maxMemoryEntries ?? 1000)) {
        const oldest = this.memory.keys().next().value;
        if (oldest !== undefined) this.memory.delete(oldest);
      }
      this.memory.set(key, { value, expires: this.now() + this.opts.ttlSeconds * 1000 });
      return;
    }
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', this.opts.ttlSeconds);
    } catch (err) {
      this.failed(err);
    }
  }

  private failed(err: unknown): void {
    this.opts.onFallback?.('cache');
    if (Date.now() - this.lastLog > 10_000) {
      this.lastLog = Date.now();
      this.opts.logger?.warn(
        { err: (err as Error).message },
        'cache unavailable; treating as a miss',
      );
    }
  }
}
