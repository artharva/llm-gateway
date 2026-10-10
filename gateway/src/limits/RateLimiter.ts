import type Redis from 'ioredis';
import type { Logger } from '../logger';
import { Failover } from '../redis/failover';
import { bucketFor, takeToken, TOKEN_BUCKET_LUA, type BucketState } from './tokenBucket';

export interface RateDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
}

export interface LimiterOptions {
  now?: () => number;
  logger?: Logger;
  onFallback?: (component: string) => void;
}

/** Per-key token buckets in Redis, shared by every gateway instance. */
export class RateLimiter {
  private readonly memory = new Map<number, BucketState>();
  private readonly failover: Failover;
  private readonly now: () => number;

  constructor(
    private readonly redis: Redis | null,
    opts: LimiterOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.failover = new Failover('rate-limiter', opts.logger, opts.onFallback);
  }

  async take(keyId: number, ratePerMin: number, burst: number): Promise<RateDecision> {
    const cfg = bucketFor(ratePerMin, burst);
    const now = this.now();
    const local = (): RateDecision => {
      const d = takeToken(this.memory.get(keyId), cfg, now);
      this.memory.set(keyId, d.state);
      return {
        allowed: d.allowed,
        limit: ratePerMin,
        remaining: d.remaining,
        retryAfterMs: d.retryAfterMs,
      };
    };
    if (!this.redis) return local();
    const redis = this.redis;
    return this.failover.run(async () => {
      const [allowed, tokens, retryAfterMs] = (await redis.eval(
        TOKEN_BUCKET_LUA,
        1,
        `rl:${keyId}`,
        cfg.capacity,
        cfg.refillPerMs,
        now,
        1,
      )) as [number, string, number];
      return {
        allowed: allowed === 1,
        limit: ratePerMin,
        remaining: Math.floor(Number(tokens)),
        retryAfterMs,
      };
    }, local);
  }
}
