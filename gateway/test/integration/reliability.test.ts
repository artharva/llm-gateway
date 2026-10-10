import type Redis from 'ioredis';
import request from 'supertest';
import { createApp } from '../../src/app';
import { ResponseCache } from '../../src/cache/ResponseCache';
import { parseGatewayConfig } from '../../src/config/gatewayConfig';
import { MemoryKeyStore } from '../../src/db/keyStore';
import { BudgetTracker } from '../../src/limits/BudgetTracker';
import { RateLimiter } from '../../src/limits/RateLimiter';
import { MemoryLogSink } from '../../src/logging/requestLog';
import { silentLogger } from '../../src/logger';
import { KeyResolver } from '../../src/middleware/auth';
import { createProviders } from '../../src/providers/registry';
import { CircuitBreakers, RedisBreakerStore } from '../../src/reliability/CircuitBreaker';
import { Router } from '../../src/router/Router';
import { breakerContract } from '../helpers/breakerContract';
import { describeIntegration } from '../helpers/env';
import { testBreakerSettings } from '../helpers/fakes';
import { startMockUpstream } from '../helpers/mockUpstream';
import { testRedis } from '../helpers/redis';

describeIntegration('RedisBreakerStore (Lua scripts)', () => {
  let redis: Redis;
  beforeAll(async () => {
    redis = await testRedis();
  });
  afterAll(() => redis.quit());

  breakerContract(async () => new RedisBreakerStore(redis, testBreakerSettings, `test-breaker`));
});

describeIntegration('fallback through the full app with a failing mock provider', () => {
  let redis: Redis;
  let upstream: Awaited<ReturnType<typeof startMockUpstream>>;
  let app: ReturnType<typeof createApp>;
  let key: string;
  let breakers: CircuitBreakers;

  beforeAll(async () => {
    redis = await testRedis();
    upstream = await startMockUpstream();
    const config = parseGatewayConfig(
      {
        providers: {
          'mock-primary': { type: 'mock', model: 'mock-1', baseUrl: `${upstream.url}/primary` },
          'mock-backup': { type: 'mock', model: 'mock-1', baseUrl: `${upstream.url}/backup` },
        },
        aliases: { mock: { chain: ['mock-primary', 'mock-backup'], timeoutMs: 1000 } },
        retry: { maxRetries: 2, baseDelayMs: 5, maxDelayMs: 20 },
      },
      {},
    );
    breakers = new CircuitBreakers(config.breaker, new RedisBreakerStore(redis, config.breaker));
    const store = new MemoryKeyStore();
    key = (await store.create({ name: 'it' })).key;
    app = createApp({
      keys: new KeyResolver(store),
      router: new Router(config, createProviders(config, {}), breakers),
      limiter: new RateLimiter(redis),
      budget: new BudgetTracker(redis),
      cache: new ResponseCache(redis, { ttlSeconds: 60 }),
      cacheKeyOptions: config.cache,
      logs: new MemoryLogSink(),
      prices: {},
      health: { providers: new Map(), breakers },
      logger: silentLogger,
    });
  });

  afterAll(async () => {
    await upstream.close();
    await redis.quit();
  });

  const send = () =>
    request(app)
      .post('/v1/chat')
      .set('Authorization', `Bearer ${key}`)
      .set('X-Gateway-Cache', 'bypass')
      .send({ model: 'mock', messages: [{ role: 'user', content: 'ping' }] });

  it('serves from the primary while it is healthy', async () => {
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('mock-primary');
  });

  it('keeps every request successful when the primary fails 100%, and opens its breaker', async () => {
    await upstream.control('primary', { failureRate: 1 });
    const statuses: number[] = [];
    const providers: string[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await send();
      statuses.push(res.status);
      providers.push(res.body.provider);
    }
    expect(statuses.every((s) => s === 200)).toBe(true);
    expect(new Set(providers)).toEqual(new Set(['mock-backup']));

    const snapshot = await breakers.snapshot('mock-primary');
    expect(snapshot.state).toBe('open');
    // The state is in Redis, where every gateway instance can see it.
    expect(await redis.hget('breaker:mock-primary', 'state')).toBe('open');

    // Once open, the primary is not called at all.
    const before = (await upstream.stats())['primary']!.requests;
    await send();
    expect((await upstream.stats())['primary']!.requests).toBe(before);
  });
});
