import type Redis from 'ioredis';
import { BudgetTracker } from '../../src/limits/BudgetTracker';
import { RateLimiter } from '../../src/limits/RateLimiter';
import { bucketFor, takeToken, type BucketState } from '../../src/limits/tokenBucket';
import { describeIntegration } from '../helpers/env';
import { testRedis } from '../helpers/redis';

describeIntegration('RateLimiter on Redis (Lua token bucket)', () => {
  let redis: Redis;
  beforeAll(async () => {
    redis = await testRedis();
  });
  afterAll(() => redis.quit());

  it('makes the same decisions as the TypeScript reference over a scripted timeline', async () => {
    let now = 5_000_000;
    const limiter = new RateLimiter(redis, { now: () => now });
    const cfg = bucketFor(30, 5);
    let state: BucketState | undefined;
    const steps = [0, 0, 0, 0, 0, 0, 0, 500, 1500, 1999, 2000, 2001, 10_000, 0, 0, 0, 0, 0, 0];
    for (const step of steps) {
      now += step;
      const ref = takeToken(state, cfg, now);
      state = ref.state;
      const got = await limiter.take(101, 30, 5);
      expect({
        allowed: got.allowed,
        remaining: got.remaining,
        retryAfterMs: got.retryAfterMs,
      }).toEqual({
        allowed: ref.allowed,
        remaining: ref.remaining,
        retryAfterMs: ref.retryAfterMs,
      });
    }
  });

  it('is atomic: 200 concurrent requests against a burst of 20 let exactly 20 through', async () => {
    const limiter = new RateLimiter(redis, { now: () => 9_000_000 });
    const results = await Promise.all(Array.from({ length: 200 }, () => limiter.take(202, 1, 20)));
    expect(results.filter((r) => r.allowed)).toHaveLength(20);
  });

  it('expires idle buckets', async () => {
    await new RateLimiter(redis).take(303, 60, 60);
    const ttl = await redis.pttl('rl:303');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(61_000);
  });
});

describeIntegration('BudgetTracker on Redis', () => {
  let redis: Redis;
  const now = Date.UTC(2026, 9, 10);
  beforeAll(async () => {
    redis = await testRedis();
  });
  afterAll(() => redis.quit());

  it('adds usage atomically and keeps the counter for 40 days', async () => {
    const budget = new BudgetTracker(redis, { now: () => now });
    await Promise.all(Array.from({ length: 50 }, () => budget.record(1, 10)));
    expect(await budget.used(1)).toBe(500);
    expect(await redis.ttl('usage:1:2026-10')).toBeGreaterThan(39 * 24 * 3600);
  });

  it('rebuilds a lost counter from the durable log once', async () => {
    const seed = jest.fn(async () => 1234);
    const budget = new BudgetTracker(redis, { now: () => now, seed });
    expect(await budget.used(2)).toBe(1234);
    expect(await budget.used(2)).toBe(1234);
    expect(seed).toHaveBeenCalledTimes(1);
    expect(seed).toHaveBeenCalledWith(2, new Date('2026-10-01T00:00:00.000Z'));
  });
});
