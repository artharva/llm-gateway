import type Redis from 'ioredis';
import request from 'supertest';
import { createApp } from '../../src/app';
import { ResponseCache } from '../../src/cache/ResponseCache';
import { MemoryKeyStore } from '../../src/db/keyStore';
import { BudgetTracker } from '../../src/limits/BudgetTracker';
import { RateLimiter } from '../../src/limits/RateLimiter';
import { MemoryLogSink } from '../../src/logging/requestLog';
import { silentLogger } from '../../src/logger';
import { KeyResolver } from '../../src/middleware/auth';
import { CircuitBreakers, RedisBreakerStore } from '../../src/reliability/CircuitBreaker';
import { Router } from '../../src/router/Router';
import { describeIntegration } from '../helpers/env';
import { fakeConfig, FakeProvider, providerMap } from '../helpers/fakes';
import { testRedis } from '../helpers/redis';

describeIntegration('response cache shared through Redis', () => {
  let redis: Redis;
  beforeAll(async () => {
    redis = await testRedis();
  });
  afterAll(() => redis.quit());

  /** Two gateway "instances" that share only Redis and the key store. */
  async function twoInstances() {
    const store = new MemoryKeyStore();
    const { key } = await store.create({ name: 'shared', ratePerMin: 1000, burst: 1000 });
    const config = fakeConfig({ fast: { chain: ['primary'] } }, { cache: { ttlSeconds: 120 } });
    const providers = [new FakeProvider('primary'), new FakeProvider('primary')];
    const apps = providers.map((p) =>
      createApp({
        keys: new KeyResolver(store),
        router: new Router(
          config,
          providerMap(p),
          new CircuitBreakers(config.breaker, new RedisBreakerStore(redis, config.breaker)),
        ),
        limiter: new RateLimiter(redis),
        budget: new BudgetTracker(redis),
        cache: new ResponseCache(redis, { ttlSeconds: config.cache.ttlSeconds }),
        cacheKeyOptions: config.cache,
        logs: new MemoryLogSink(),
        prices: {},
        health: { providers: new Map(), breakers: new CircuitBreakers(config.breaker, null) },
        logger: silentLogger,
      }),
    );
    return { apps, providers, key };
  }

  it('an answer cached by one instance is a hit on another, stored with the TTL', async () => {
    const { apps, providers, key } = await twoInstances();
    const body = { model: 'fast', messages: [{ role: 'user', content: 'shared question' }] };
    const a = await request(apps[0]!)
      .post('/v1/chat')
      .set('Authorization', `Bearer ${key}`)
      .send(body);
    const b = await request(apps[1]!)
      .post('/v1/chat')
      .set('Authorization', `Bearer ${key}`)
      .send(body);
    expect(a.headers['x-cache']).toBe('MISS');
    expect(b.headers['x-cache']).toBe('HIT');
    expect(providers[1]!.calls).toHaveLength(0);

    const keys = await redis.keys('cache:v1:*');
    expect(keys).toHaveLength(1);
    const ttl = await redis.ttl(keys[0]!);
    expect(ttl).toBeGreaterThan(100);
    expect(ttl).toBeLessThanOrEqual(120);
  });
});
